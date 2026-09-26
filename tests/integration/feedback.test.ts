import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginWithInvite } from "@/lib/auth/session";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import type { AnswerPayload } from "@/lib/grading";
import { deleteAccountForUser } from "@/lib/services/account";
import { submitAttemptForUser } from "@/lib/services/attempts";
import { buildFeedbackCandidates } from "@/lib/services/export";
import { submitFeedbackForUser } from "@/lib/services/feedback";
import { createExamForMaterial, generateOutlineForMaterial } from "@/lib/services/generation";
import { createMaterialForUser } from "@/lib/services/materials";
import { FakeEngine, SAMPLE_MATERIAL, noul, resetOverrides, useMemoryStore } from "../helpers";

describe("纠错上报与账号删除", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];

  beforeEach(async () => {
    store = useMemoryStore();
    setGenerationProviderOverride(new HeuristicGenerationProvider());
    setDecisionEngineOverride(
      new FakeEngine((_state, questions) => {
        const answers: Record<string, ReturnType<typeof noul>> = {};
        for (const key of Object.keys(questions)) {
          answers[key] = key.startsWith("point_") ? noul(0.95) : noul(0.05);
        }
        return answers;
      }),
    );
    await store.upsertInviteCode("FB-CODE", 10);
    user = (await loginWithInvite("feedback@example.com", "FB-CODE")).user;
  });

  afterEach(() => resetOverrides());

  async function seedJudgedQuestion() {
    const material = await createMaterialForUser(user, {
      title: "反馈材料",
      rawText: SAMPLE_MATERIAL,
    });
    await generateOutlineForMaterial(user, material.id, { topicCount: 3 });
    const exam = await createExamForMaterial(user, {
      materialId: material.id,
      topicIds: [],
      count: 6,
      mix: { mcq: 2, true_false: 1, short_answer: 2 },
    });
    const questions = await store.getQuestions(await store.listExamQuestionIds(exam.exam.id));
    // 客观题由代码判定、主观题才走 DecisionEngine，两者要分别覆盖
    const objective = questions.find((question) => question.type !== "short_answer");
    const subjective = questions.find((question) => question.type === "short_answer");
    expect(objective).toBeDefined();
    expect(subjective).toBeDefined();
    const answers = questions.map((question) => {
      let payload: AnswerPayload;
      if (question.type === "mcq") payload = { type: "mcq", index: 0 };
      else if (question.type === "true_false") payload = { type: "true_false", value: true };
      else if (question.type === "cloze") payload = { type: "cloze", text: "光反应" };
      else payload = { type: "short_answer", text: "光反应发生在类囊体薄膜上，需要光照。" };
      return { questionId: question.id, payload };
    });
    const submission = await submitAttemptForUser(user, exam.exam.id, answers);
    return {
      material,
      objective: objective!,
      subjective: subjective!,
      attemptId: submission.attemptId,
    };
  }

  it("上报会冻结当时的判定现场，而不只是记一个 questionId", async () => {
    const { subjective, attemptId } = await seedJudgedQuestion();

    const report = await submitFeedbackForUser(user, {
      questionId: subjective.id,
      attemptId,
      kind: "wrong_score",
      note: "我答到了要点，但被判未命中。",
    });

    expect(report.kind).toBe("wrong_score");
    expect(report.snapshot.materialTitle).toBe("反馈材料");
    expect(report.snapshot.stem).toBe(subjective.stem);
    expect(report.snapshot.questionType).toBe("short_answer");
    // 判定的引擎与结果必须一起冻结，否则之后无法复核
    expect(report.snapshot.engineId).toBe("fake-engine");
    expect(report.snapshot.engineModel).toBe("fake-1.0.0");
    // 主观题的关键信息是逐得分点的概率，必须留下来
    expect(report.snapshot.points.length).toBeGreaterThan(0);
    expect(report.snapshot.referenceAnswer).toBeTruthy();
    // 作答原文也要能复原
    expect(report.snapshot.payload).toEqual({
      type: "short_answer",
      text: "光反应发生在类囊体薄膜上，需要光照。",
    });
  });

  it("不带 attemptId 时会自己找到最近一次判定", async () => {
    const { objective } = await seedJudgedQuestion();
    const report = await submitFeedbackForUser(user, {
      questionId: objective.id,
      kind: "bad_question",
    });
    expect(report.attemptId).not.toBeNull();
    expect(report.snapshot.scorePercent).not.toBeNull();
    // 客观题不经过决策模型，引擎标记为确定性判分是对的
    expect(report.snapshot.engineId).toBe("deterministic");
  });

  it("非法类型与别人的题目都会被拒绝", async () => {
    const { objective } = await seedJudgedQuestion();
    await expect(
      submitFeedbackForUser(user, { questionId: objective.id, kind: "不存在" }),
    ).rejects.toThrow("请选择问题类型");

    const intruder = (await loginWithInvite("fb-intruder@example.com", "FB-CODE")).user;
    await expect(
      submitFeedbackForUser(intruder, { questionId: objective.id, kind: "wrong_score" }),
    ).rejects.toThrow("题目不存在");
  });

  it("上报可以导出成金标准候选", async () => {
    const { subjective, attemptId } = await seedJudgedQuestion();
    await submitFeedbackForUser(user, {
      questionId: subjective.id,
      attemptId,
      kind: "wrong_reference",
      note: "参考答案与材料第 2 句不一致。",
    });

    const lines = (await buildFeedbackCandidates()).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as {
      kindLabel: string;
      note: string;
      question: string;
      engine: string;
    };
    expect(parsed.kindLabel).toBe("参考答案不对");
    expect(parsed.note).toContain("第 2 句");
    expect(parsed.question).toBe(subjective.stem);
    expect(parsed.engine).toBe("fake-engine");
  });

  it("删除账号会清空该用户的全部数据", async () => {
    const { objective, attemptId } = await seedJudgedQuestion();
    await submitFeedbackForUser(user, { questionId: objective.id, attemptId, kind: "other" });

    await deleteAccountForUser(user, user.email);

    expect(await store.getUser(user.id)).toBeNull();
    expect(await store.listMaterials(user.id)).toHaveLength(0);
    expect(await store.listAttemptsByUser(user.id)).toHaveLength(0);
    expect(await store.listFeedback(user.id)).toHaveLength(0);
    expect(await store.listReviewItems(user.id)).toHaveLength(0);
  });

  it("邮箱不匹配时拒绝删除", async () => {
    await seedJudgedQuestion();
    await expect(deleteAccountForUser(user, "someone-else@example.com")).rejects.toThrow(
      "不一致",
    );
    expect(await store.getUser(user.id)).not.toBeNull();
  });
});
