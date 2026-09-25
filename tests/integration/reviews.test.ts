import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginWithInvite } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import type { AnswerPayload } from "@/lib/grading";
import { submitAttemptForUser } from "@/lib/services/attempts";
import { createExamForMaterial, generateOutlineForMaterial } from "@/lib/services/generation";
import { createMaterialForUser } from "@/lib/services/materials";
import {
  gradeReviewAnswer,
  listDueReviewCards,
  reviewStats,
  syncReviewsFromAttempt,
} from "@/lib/services/reviews";
import { FakeEngine, SAMPLE_MATERIAL, noul, resetOverrides, useMemoryStore } from "../helpers";

/** 判定模拟：客观题走确定性代码，主观题的高分/低分由这里控制 */
function judgeEngine(pointProbability = 0.95) {
  return new FakeEngine((_state, questions) => {
    const answers: Record<string, ReturnType<typeof noul>> = {};
    for (const key of Object.keys(questions)) {
      if (key.startsWith("point_")) answers[key] = noul(pointProbability);
      else if (key === "equivalent") answers[key] = noul(0.05);
      else answers[key] = noul(0.03);
    }
    return answers;
  });
}

describe("复习排程（FSRS）", () => {
  let store: ReturnType<typeof useMemoryStore>;

  beforeEach(async () => {
    store = useMemoryStore();
    setGenerationProviderOverride(new HeuristicGenerationProvider());
    setDecisionEngineOverride(judgeEngine());
    await store.upsertInviteCode("REVIEW-CODE", 10);
  });

  afterEach(() => resetOverrides());

  it("交卷后错题立刻进入复习队列，答对则推进排期", async () => {
    const user = (await loginWithInvite("reviewer@example.com", "REVIEW-CODE")).user;
    const material = await createMaterialForUser(user, {
      title: "复习材料",
      rawText: SAMPLE_MATERIAL,
    });
    await generateOutlineForMaterial(user, material.id, { topicCount: 3 });
    const exam = await createExamForMaterial(user, {
      materialId: material.id,
      topicIds: [],
      count: 6,
      mix: { mcq: 3, true_false: 2, cloze: 1 },
    });

    const questionIds = await store.listExamQuestionIds(exam.exam.id);
    const questions = await store.getQuestions(questionIds);
    const [first, ...rest] = questions;

    const answers = questions.map((question) => {
      const wrong = question.id === first.id;
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
            value: wrong ? !(question.answerKey.true_false?.answer ?? true) : (question.answerKey.true_false?.answer ?? true),
          };
          break;
        default:
          payload = { type: "cloze", text: wrong ? "明显错误的答案" : (question.answerKey.cloze?.answer ?? "") };
      }
      return { questionId: question.id, payload };
    });

    const submission = await submitAttemptForUser(user, exam.exam.id, answers);

    // 错题进入队列，其余答对的不进队列
    const items = await store.listReviewItems(user.id);
    expect(items).toHaveLength(1);
    expect(items[0].questionId).toBe(first.id);
    expect(items[0].lastRating).toBe(1);
    expect(items[0].dueAt.getTime()).toBeLessThanOrEqual(Date.now());

    const stats = await reviewStats(user);
    expect(stats.due).toBe(1);
    expect(stats.total).toBe(1);

    const due = await listDueReviewCards(user);
    expect(due.map((card) => card.question.id)).toEqual([first.id]);

    // 复习时答对：评分自动变高，下次间隔被推远
    const correctPayload: AnswerPayload =
      first.type === "mcq"
        ? { type: "mcq", index: first.answerKey.mcq?.correct_index ?? 0 }
        : first.type === "true_false"
          ? { type: "true_false", value: first.answerKey.true_false?.answer ?? true }
          : { type: "cloze", text: first.answerKey.cloze?.answer ?? "" };

    const reviewed = await gradeReviewAnswer(user, first.id, correctPayload);
    expect(reviewed.scorePercent).toBe(100);
    expect(reviewed.rating).toBe(4);
    expect(reviewed.scheduledDays).toBeGreaterThan(0);
    expect(reviewed.nextDueAt.getTime()).toBeGreaterThan(Date.now());
    expect(reviewed.intervalLabel).toContain("后");

    // 队列清空，但卡片仍在（只是排到了未来）
    expect((await listDueReviewCards(user)).length).toBe(0);
    expect((await reviewStats(user)).total).toBe(1);

    // 复习时再次答错：评分回落到 1，10 分钟后重来
    const wrongAgain = await gradeReviewAnswer(user, first.id, {
      type: first.type === "cloze" ? "cloze" : "mcq",
      ...(first.type === "cloze" ? { text: "还是错的" } : { index: 2 }),
    } as AnswerPayload);
    expect(wrongAgain.rating).toBe(1);
    expect(wrongAgain.nextDueAt.getTime() - Date.now()).toBeLessThan(60 * 60 * 1000);
    expect(submission.judgedCount).toBe(questions.length);
    expect(rest.length).toBeGreaterThan(0);
  });

  it("待复核的判定不进入复习排程", async () => {
    setDecisionEngineOverride(judgeEngine(0.5)); // 强度 0 → 全部待复核
    const user = (await loginWithInvite("uncertain@example.com", "REVIEW-CODE")).user;
    const material = await createMaterialForUser(user, {
      title: "不确定材料",
      rawText: SAMPLE_MATERIAL,
    });
    await generateOutlineForMaterial(user, material.id, { topicCount: 3 });
    const exam = await createExamForMaterial(user, {
      materialId: material.id,
      topicIds: [],
      count: 4,
      mix: { short_answer: 1, mcq: 1, true_false: 1 },
    });
    const questionIds = await store.listExamQuestionIds(exam.exam.id);
    const questions = await store.getQuestions(questionIds);

    // 主观题给一个低分答案，但判定强度不足 → 应记为待复核
    const answers = questions.map((question) => {
      let payload: AnswerPayload;
      switch (question.type) {
        case "mcq":
          payload = { type: "mcq", index: question.answerKey.mcq?.correct_index ?? 0 };
          break;
        case "true_false":
          payload = { type: "true_false", value: question.answerKey.true_false?.answer ?? true };
          break;
        case "cloze":
          payload = { type: "cloze", text: question.answerKey.cloze?.answer ?? "" };
          break;
        default:
          payload = { type: "short_answer", text: "随便写一点" };
      }
      return { questionId: question.id, payload };
    });

    // 这组题必须真的包含一道主观题，否则“待复核不入队列”没有被验证到
    expect(questions.some((question) => question.type === "short_answer")).toBe(true);

    await submitAttemptForUser(user, exam.exam.id, answers);
    const attempt = (await store.listAttemptsByUser(user.id))[0];
    const sync = await syncReviewsFromAttempt(user, attempt.id);
    expect(sync.kept).toBeGreaterThan(0);
    expect(await store.listReviewItems(user.id)).toHaveLength(0);
  });
});
