import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginWithInvite } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { setDecisionEngineOverride } from "@/lib/engine";
import { ForbiddenError } from "@/lib/errors";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import type { AnswerPayload } from "@/lib/grading";
import { createExamForMaterial, createMistakeRetryExam, generateOutlineForMaterial } from "@/lib/services/generation";
import { createMaterialForUser, deleteMaterialForUser } from "@/lib/services/materials";
import { submitAttemptForUser } from "@/lib/services/attempts";
import { listMasteryForUser, listMistakeGroups } from "@/lib/services/mistakes";
import { getAttemptResultForUser, listExamSummaries } from "@/lib/services/results";
import { FakeEngine, SAMPLE_MATERIAL, noul, resetOverrides, useMemoryStore } from "../helpers";

function flowEngine() {
  return new FakeEngine((_state, questions) => {
    const answers: Record<string, ReturnType<typeof noul>> = {};
    for (const key of Object.keys(questions)) {
      if (key.startsWith("point_")) answers[key] = noul(0.92);
      else if (key === "equivalent") answers[key] = noul(0.08);
      else answers[key] = noul(0.03);
    }
    return answers;
  });
}

describe("端到端闭环（服务层）", () => {
  let store: ReturnType<typeof useMemoryStore>;

  beforeEach(async () => {
    store = useMemoryStore();
    setGenerationProviderOverride(new HeuristicGenerationProvider());
    setDecisionEngineOverride(flowEngine());
    await store.upsertInviteCode("TEST-CODE", 10);
  });

  afterEach(() => {
    resetOverrides();
  });

  it("邀请码注册 → 出题 → 作答 → 判定 → 错题本 → 重考", async () => {
    // 1. 邀请制登录
    const login = await loginWithInvite("learner@example.com", "TEST-CODE");
    expect(login.created).toBe(true);
    expect(login.user.email).toBe("learner@example.com");

    const secondLogin = await loginWithInvite("learner@example.com");
    expect(secondLogin.created).toBe(false);

    // 无邀请码的新用户被拒绝
    await expect(loginWithInvite("stranger@example.com")).rejects.toThrow(/邀请码/);
    await expect(loginWithInvite("bad@example.com", "WRONG-CODE")).rejects.toThrow(
      /邀请码无效/,
    );

    const user = login.user;

    // 2. 上传材料
    const material = await createMaterialForUser(user, {
      title: "生物 · 光合作用",
      rawText: SAMPLE_MATERIAL,
    });
    expect(material.tokenCount).toBeGreaterThan(0);

    // 3. 生成知识点大纲
    const outline = await generateOutlineForMaterial(user, material.id, { topicCount: 3 });
    expect(outline.topics.length).toBeGreaterThan(0);

    // 4. 生成试卷
    const created = await createExamForMaterial(user, {
      materialId: material.id,
      topicIds: [],
      count: 8,
      mix: { mcq: 3, true_false: 2, cloze: 1, short_answer: 2 },
    });
    expect(created.exam.config.count).toBeGreaterThan(3);

    const questionIds = await store.listExamQuestionIds(created.exam.id);
    const questions = await store.getQuestions(questionIds);
    expect(questions).toHaveLength(questionIds.length);

    // 5. 作答：第一题故意答错，其余答对
    const answers = questions.map((question, index) => {
      const wrong = index === 0;
      let payload: AnswerPayload;
      switch (question.type) {
        case "mcq":
          payload = {
            type: "mcq",
            index: wrong
              ? ((question.answerKey.mcq?.correct_index ?? 0) + 1) % 4
              : (question.answerKey.mcq?.correct_index ?? 0),
          };
          break;
        case "true_false":
          payload = {
            type: "true_false",
            value: wrong
              ? !(question.answerKey.true_false?.answer ?? true)
              : (question.answerKey.true_false?.answer ?? true),
          };
          break;
        case "cloze":
          payload = { type: "cloze", text: wrong ? "完全不相关的答案" : question.answerKey.cloze?.answer ?? "" };
          break;
        case "short_answer":
          payload = {
            type: "short_answer",
            text: question.answerKey.short_answer?.reference_answer ?? "",
          };
          break;
      }
      return { questionId: question.id, payload };
    });

    // 6. 提交判定
    const submission = await submitAttemptForUser(user, created.exam.id, answers);
    expect(submission.judgedCount).toBe(questions.length);
    expect(submission.scorePercent).toBeGreaterThan(0);
    expect(submission.scorePercent).toBeLessThanOrEqual(100);
    expect(submission.needsReviewCount).toBe(0);

    // 7. 结果视图
    const result = await getAttemptResultForUser(user, submission.attemptId);
    expect(result.questions).toHaveLength(questions.length);
    expect(result.totals.needsReviewCount).toBe(0);
    expect(result.questions.every((view) => view.judgment !== null)).toBe(true);

    // 8. 错题本：第一题进入错题本
    const groups = await listMistakeGroups(user);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.mistake.questionId)).toContain(questions[0].id);

    // 9. 掌握度：答错的题目所在知识点掌握度低于 1
    const mastery = await listMasteryForUser(user);
    expect(mastery.length).toBeGreaterThan(0);
    expect(mastery.some((record) => record.value < 1)).toBe(true);

    // 10. 一键重考错题：复用原题，不重新出题
    const retry = await createMistakeRetryExam(user, material.id);
    expect(retry.exam.kind).toBe("mistake_retry");
    expect(retry.questionIds).toEqual(groups[0].items.map((item) => item.mistake.questionId));

    // 11. 试卷列表与最近成绩
    const summaries = await listExamSummaries(user);
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    expect(summaries.some((summary) => summary.latestAttempt !== null)).toBe(true);

    // 12. 删除材料 → 派生数据一并清理
    await deleteMaterialForUser(user, material.id);
    expect(await store.getMaterial(material.id)).toBeNull();
    expect(await store.listExamQuestionIds(created.exam.id)).toHaveLength(0);
    expect(await listMistakeGroups(user)).toHaveLength(0);
  });

  it("跨用户访问被拒绝", async () => {
    const owner = (await loginWithInvite("owner@example.com", "TEST-CODE")).user;
    const intruder = (await loginWithInvite("intruder@example.com", "TEST-CODE")).user;
    const material = await createMaterialForUser(owner, {
      title: "私有材料",
      rawText: SAMPLE_MATERIAL,
    });

    await expect(
      getStore().getMaterial(material.id).then((record) => record?.userId),
    ).resolves.toBe(owner.id);

    const { getMaterialForUser } = await import("@/lib/services/materials");
    await expect(getMaterialForUser(intruder, material.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
