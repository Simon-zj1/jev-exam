import { getStore } from "@/lib/db";
import type { AttemptRecord, JudgmentRecord, QuestionRecord, UserRecord } from "@/lib/db/types";
import { resolveDecisionEngine } from "@/lib/engine";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { gradeQuestion, type AnswerPayload } from "@/lib/grading";
import { topicKeyOf } from "@/lib/ids";
import { assertQuota, recordUsage } from "@/lib/quota";
import { readByok } from "@/lib/services/byok";
import { getExamForUser } from "@/lib/services/generation";
import { toGeneratedQuestion } from "@/lib/services/questions";
import type { AnswerKey } from "@/lib/types";

const MISTAKE_THRESHOLD_PERCENT = 60;

export type SubmitAnswerInput = {
  questionId: string;
  payload: AnswerPayload | null;
};

export type SubmitResult = {
  attemptId: string;
  scorePercent: number;
  needsReviewCount: number;
  engineId: string;
  engineMode: "byok" | "platform" | "offline";
  judgedCount: number;
};

export async function startAttemptForUser(
  user: UserRecord,
  examId: string,
): Promise<AttemptRecord> {
  const exam = await getExamForUser(user, examId);
  const store = getStore();
  const open = await store.getOpenAttempt(exam.id, user.id);
  if (open) return open;
  return store.createAttempt(exam.id, user.id);
}

export async function submitAttemptForUser(
  user: UserRecord,
  examId: string,
  answers: SubmitAnswerInput[],
): Promise<SubmitResult> {
  const exam = await getExamForUser(user, examId);
  const store = getStore();
  const questionIds = await store.listExamQuestionIds(exam.id);
  const questions = await store.getQuestions(questionIds);
  if (questions.length === 0) throw new NotFoundError("试卷中没有题目");

  const orderedQuestions = questionIds
    .map((id) => questions.find((question) => question.id === id))
    .filter((question): question is QuestionRecord => Boolean(question));

  const payloadMap = new Map(answers.map((answer) => [answer.questionId, answer.payload]));
  const attempt = (await store.getOpenAttempt(exam.id, user.id)) ?? (await store.createAttempt(exam.id, user.id));

  const byok = readByok(user);
  const selection = resolveDecisionEngine({ byok });
  const engine = selection.engine;

  const needsEngineCount = orderedQuestions.filter(
    (question) => question.type === "short_answer" || question.type === "cloze",
  ).length;
  if (selection.countsAgainstQuota) {
    await assertQuota(user.id, { judgment: needsEngineCount });
  }

  const blueprint = await store.getBlueprintById(exam.blueprintId);
  const topicSpans = new Map<string, string>();
  for (const topic of blueprint?.topics ?? []) {
    topicSpans.set(topic.id, topic.source_spans.join("\n"));
  }

  let engineCalls = 0;
  const scores: number[] = [];
  const judgments: JudgmentRecord[] = [];

  for (const question of orderedQuestions) {
    const payload = payloadMap.get(question.id) ?? null;
    const answer = await store.saveAnswer(attempt.id, question.id, payload);
    const judgment = await gradeQuestion(toGeneratedQuestion(question), payload, {
      engine,
      materialExcerpt: topicSpans.get(question.topicId) ?? "",
    });

    const saved = await store.saveJudgment({
      answerId: answer.id,
      attemptId: attempt.id,
      questionId: question.id,
      userId: user.id,
      method: judgment.method,
      score: judgment.score,
      scorePercent: judgment.scorePercent,
      confidence: judgment.confidence,
      needsReview: judgment.needsReview,
      reviewReasons: judgment.reviewReasons,
      points: judgment.points,
      penalties: judgment.penalties,
      scoreLow: judgment.scoreRange?.[0] ?? null,
      scoreHigh: judgment.scoreRange?.[1] ?? null,
      engineId: judgment.engineId,
      model: judgment.model,
      latencyMs: judgment.latencyMs,
      request: {
        questionId: question.id,
        payload,
        materialExcerptLength: (topicSpans.get(question.topicId) ?? "").length,
      },
      response: judgment.raw ?? null,
    });

    if (judgment.usedEngine) engineCalls += 1;
    scores.push(judgment.score);
    judgments.push(saved);

    // 待复核的题目不计入掌握度，避免用不确定的黑盒分数误导用户。
    if (!judgment.needsReview) {
      await store.applyMastery(
        user.id,
        topicKeyOf(question.topicTitle),
        question.topicTitle,
        judgment.score,
      );
    }

    if (judgment.scorePercent < MISTAKE_THRESHOLD_PERCENT) {
      await store.upsertMistake({
        userId: user.id,
        questionId: question.id,
        materialId: question.materialId,
        topicKey: topicKeyOf(question.topicTitle),
        topicTitle: question.topicTitle,
        lastScorePercent: judgment.scorePercent,
        lastAttemptId: attempt.id,
        increment: true,
      });
    } else {
      await store.deleteMistake(user.id, question.id);
    }
  }

  const averageScore = scores.length
    ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100)
    : 0;
  const needsReviewCount = judgments.filter((judgment) => judgment.needsReview).length;

  await store.submitAttempt(attempt.id, {
    scorePercent: averageScore,
    needsReviewCount,
    submittedAt: new Date(),
  });

  if (selection.countsAgainstQuota && engineCalls > 0) {
    await recordUsage(user.id, { judgment: engineCalls });
  }

  return {
    attemptId: attempt.id,
    scorePercent: averageScore,
    needsReviewCount,
    engineId: engine.id,
    engineMode: selection.mode,
    judgedCount: judgments.length,
  };
}

export function answerKeyOfRecord(record: QuestionRecord): AnswerKey {
  return record.answerKey;
}

export async function getAttemptForUser(user: UserRecord, attemptId: string): Promise<AttemptRecord> {
  const attempt = await getStore().getAttempt(attemptId);
  if (!attempt) throw new NotFoundError("答题记录不存在");
  if (attempt.userId !== user.id) throw new ForbiddenError();
  return attempt;
}

export function assertAnswerShape(payload: unknown): AnswerPayload | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== "object") throw new ValidationError("作答格式不正确");
  const record = payload as Record<string, unknown>;
  switch (record.type) {
    case "mcq":
      return { type: "mcq", index: typeof record.index === "number" ? record.index : null };
    case "true_false":
      return { type: "true_false", value: typeof record.value === "boolean" ? record.value : null };
    case "cloze":
      return { type: "cloze", text: typeof record.text === "string" ? record.text : "" };
    case "short_answer":
      return { type: "short_answer", text: typeof record.text === "string" ? record.text : "" };
    default:
      throw new ValidationError("未知的作答类型");
  }
}
