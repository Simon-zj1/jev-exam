import { getStore } from "@/lib/db";
import type { MaterialRecord, QuestionRecord, ReviewItemRecord, UserRecord } from "@/lib/db/types";
import { resolveDecisionEngine } from "@/lib/engine";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createReviewState,
  formatInterval,
  ratingFromScore,
  scheduleReview,
  type ReviewRating,
} from "@/lib/fsrs";
import { gradeQuestion, type AnswerPayload } from "@/lib/grading";
import { topicKeyOf } from "@/lib/ids";
import { interleaveByTopic } from "@/lib/interleave";
import { usageCollector } from "@/lib/llm/usage";
import { assertQuota, recordUsage } from "@/lib/quota";
import { readByok } from "@/lib/services/byok";
import { toGeneratedQuestion, toStudentQuestion } from "@/lib/services/questions";
import { recordChatUsage } from "@/lib/services/usage";

/** 低于这个分数算「没掌握」，会进入复习队列 */
const MISTAKE_THRESHOLD_PERCENT = 60;

export type DueReviewCard = {
  item: ReviewItemRecord;
  question: QuestionRecord;
  studentView: ReturnType<typeof toStudentQuestion>;
  overdueDays: number;
};

export type ReviewStats = {
  due: number;
  total: number;
  learning: number;
  nextDueAt: Date | null;
};

export type ReviewGradeResult = {
  questionId: string;
  scorePercent: number;
  needsReview: boolean;
  reviewReasons: string[];
  rating: ReviewRating;
  scheduledDays: number;
  intervalLabel: string;
  nextDueAt: Date;
  engineId: string;
  model: string;
  latencyMs: number;
  points: { point_id: string; statement: string; probability: number; awarded: boolean }[];
};

async function loadOwnedQuestion(user: UserRecord, questionId: string): Promise<{
  question: QuestionRecord;
  material: MaterialRecord;
}> {
  const store = getStore();
  const question = await store.getQuestion(questionId);
  if (!question) throw new NotFoundError("题目不存在");
  const material = await store.getMaterial(question.materialId);
  if (!material || material.userId !== user.id) throw new ForbiddenError();
  return { question, material };
}

function overdueDays(dueAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * 交卷后把判定结果同步到复习队列：
 * - 失分的题目：没有卡片就新建（当天重来），已有卡片就按评分推进；
 * - 答对的题目：如果它在队列里，说明这次是复习成功，按评分往后排。
 */
export async function syncReviewsFromAttempt(
  user: UserRecord,
  attemptId: string,
): Promise<{ added: number; advanced: number; kept: number }> {
  const store = getStore();
  const judgments = await store.listJudgmentsByAttempt(attemptId);
  if (judgments.length === 0) return { added: 0, advanced: 0, kept: 0 };

  const questions = await store.getQuestions(judgments.map((judgment) => judgment.questionId));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const now = new Date();
  let added = 0;
  let advanced = 0;
  let kept = 0;

  for (const judgment of judgments) {
    const question = questionById.get(judgment.questionId);
    if (!question) continue;
    const existing = await store.getReviewItem(user.id, question.id);

    // 待复核的判定不进入排程：不确定的结果不该决定复习节奏
    if (judgment.needsReview) {
      kept += 1;
      continue;
    }

    const rating = ratingFromScore(judgment.scorePercent);
    const failed = judgment.scorePercent < MISTAKE_THRESHOLD_PERCENT;

    if (!existing) {
      if (!failed) continue;
      const created = createReviewState(rating, now);
      await store.upsertReviewItem({
        userId: user.id,
        questionId: question.id,
        materialId: question.materialId,
        topicKey: topicKeyOf(question.topicTitle),
        topicTitle: question.topicTitle,
        stability: created.stability,
        difficulty: created.difficulty,
        reps: created.reps,
        lapses: created.lapses,
        state: created.state,
        dueAt: created.dueAt,
        lastReviewedAt: created.lastReviewedAt,
        lastScorePercent: judgment.scorePercent,
        lastRating: rating,
      });
      added += 1;
      continue;
    }

    const next = scheduleReview(
      {
        stability: existing.stability,
        difficulty: existing.difficulty,
        reps: existing.reps,
        lapses: existing.lapses,
        state: existing.state,
        lastReviewedAt: existing.lastReviewedAt,
        dueAt: existing.dueAt,
      },
      rating,
      now,
    );
    await store.upsertReviewItem({
      userId: user.id,
      questionId: question.id,
      materialId: question.materialId,
      topicKey: topicKeyOf(question.topicTitle),
      topicTitle: question.topicTitle,
      stability: next.state.stability,
      difficulty: next.state.difficulty,
      reps: next.state.reps,
      lapses: next.state.lapses,
      state: next.state.state,
      dueAt: next.state.dueAt,
      lastReviewedAt: next.state.lastReviewedAt,
      lastScorePercent: judgment.scorePercent,
      lastRating: rating,
    });
    await store.saveReviewLog({
      userId: user.id,
      questionId: question.id,
      rating,
      scorePercent: judgment.scorePercent,
      stabilityBefore: existing.stability,
      difficultyBefore: existing.difficulty,
      stabilityAfter: next.state.stability,
      difficultyAfter: next.state.difficulty,
      elapsedDays: next.elapsedDays,
      scheduledDays: next.scheduledDays,
      reviewedAt: now,
    });
    advanced += 1;
  }

  return { added, advanced, kept };
}

export async function listDueReviewCards(
  user: UserRecord,
  limit = 20,
  now: Date = new Date(),
): Promise<DueReviewCard[]> {
  const store = getStore();
  const items = await store.listDueReviewItems(user.id, now, limit);
  const questions = await store.getQuestions(items.map((item) => item.questionId));
  const questionById = new Map(questions.map((question) => [question.id, question]));

  const cards = items
    .map((item) => {
      const question = questionById.get(item.questionId);
      if (!question) return null;
      return {
        item,
        question,
        studentView: toStudentQuestion(question),
        overdueDays: overdueDays(item.dueAt, now),
      } satisfies DueReviewCard;
    })
    .filter((card): card is DueReviewCard => Boolean(card));

  // 到期时间只决定「今天要不要出现」，出现顺序再按知识点打散（交错练习）
  return interleaveByTopic(cards, (card) => card.item.topicKey);
}

export async function reviewStats(user: UserRecord, now: Date = new Date()): Promise<ReviewStats> {
  const store = getStore();
  const items = await store.listReviewItems(user.id);
  const due = items.filter((item) => item.dueAt.getTime() <= now.getTime());
  const future = items
    .filter((item) => item.dueAt.getTime() > now.getTime())
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return {
    due: due.length,
    total: items.length,
    learning: items.filter((item) => item.state !== "review").length,
    nextDueAt: future[0]?.dueAt ?? null,
  };
}

/** 复习一张卡片：用判定链路给分，再把分数映射成 FSRS 评分推进排期。 */
export async function gradeReviewAnswer(
  user: UserRecord,
  questionId: string,
  payload: AnswerPayload | null,
  options: { ratingOverride?: ReviewRating } = {},
): Promise<ReviewGradeResult> {
  const { question } = await loadOwnedQuestion(user, questionId);
  const store = getStore();

  const byok = readByok(user);
  const usage = usageCollector();
  const selection = resolveDecisionEngine({ byok, onChatUsage: usage.onChatUsage });
  const needsEngine = question.type === "short_answer" || question.type === "cloze";
  if (selection.countsAgainstQuota && needsEngine) await assertQuota(user.id, { judgment: 1 });

  const blueprint = await store.getBlueprintById(question.blueprintId);
  const materialExcerpt =
    blueprint?.topics.find((topic) => topic.id === question.topicId)?.source_spans.join("\n") ?? "";

  let judgment;
  try {
    judgment = await gradeQuestion(toGeneratedQuestion(question), payload, {
      engine: selection.engine,
      materialExcerpt,
    });
  } finally {
    await recordChatUsage(user.id, usage.pending);
  }
  if (selection.countsAgainstQuota && judgment.usedEngine) {
    await recordUsage(user.id, { judgment: 1 });
  }

  const rating = options.ratingOverride ?? ratingFromScore(judgment.scorePercent);
  const existing = await store.getReviewItem(user.id, question.id);
  const now = new Date();
  const next = existing
    ? scheduleReview(
        {
          stability: existing.stability,
          difficulty: existing.difficulty,
          reps: existing.reps,
          lapses: existing.lapses,
          state: existing.state,
          lastReviewedAt: existing.lastReviewedAt,
          dueAt: existing.dueAt,
        },
        rating,
        now,
      )
    : { state: createReviewState(rating, now), elapsedDays: 0, scheduledDays: 0 };

  await store.upsertReviewItem({
    userId: user.id,
    questionId: question.id,
    materialId: question.materialId,
    topicKey: topicKeyOf(question.topicTitle),
    topicTitle: question.topicTitle,
    stability: next.state.stability,
    difficulty: next.state.difficulty,
    reps: next.state.reps,
    lapses: next.state.lapses,
    state: next.state.state,
    dueAt: next.state.dueAt,
    lastReviewedAt: next.state.lastReviewedAt,
    lastScorePercent: judgment.scorePercent,
    lastRating: rating,
  });

  if (existing) {
    await store.saveReviewLog({
      userId: user.id,
      questionId: question.id,
      rating,
      scorePercent: judgment.scorePercent,
      stabilityBefore: existing.stability,
      difficultyBefore: existing.difficulty,
      stabilityAfter: next.state.stability,
      difficultyAfter: next.state.difficulty,
      elapsedDays: next.elapsedDays,
      scheduledDays: next.scheduledDays,
      reviewedAt: now,
    });
  }

  return {
    questionId: question.id,
    scorePercent: judgment.scorePercent,
    needsReview: judgment.needsReview,
    reviewReasons: judgment.reviewReasons,
    rating,
    scheduledDays: next.scheduledDays,
    intervalLabel: formatInterval(next.scheduledDays),
    nextDueAt: next.state.dueAt,
    engineId: judgment.engineId,
    model: judgment.model,
    latencyMs: judgment.latencyMs,
    points: judgment.points.map((point) => ({
      point_id: point.point_id,
      statement: point.statement,
      probability: point.probability,
      awarded: point.awarded,
    })),
  };
}

/** 自评推进（例如手写作答无法自动判定时，让学习者自己给评分） */
export async function selfReportReview(
  user: UserRecord,
  questionId: string,
  rating: ReviewRating,
): Promise<{ nextDueAt: Date; scheduledDays: number; intervalLabel: string }> {
  if (![1, 2, 3, 4].includes(rating)) throw new ValidationError("评分必须是 1–4");
  const { question } = await loadOwnedQuestion(user, questionId);
  const store = getStore();
  const existing = await store.getReviewItem(user.id, question.id);
  const now = new Date();
  const next = existing
    ? scheduleReview(
        {
          stability: existing.stability,
          difficulty: existing.difficulty,
          reps: existing.reps,
          lapses: existing.lapses,
          state: existing.state,
          lastReviewedAt: existing.lastReviewedAt,
          dueAt: existing.dueAt,
        },
        rating,
        now,
      )
    : { state: createReviewState(rating, now), elapsedDays: 0, scheduledDays: 0 };

  await store.upsertReviewItem({
    userId: user.id,
    questionId: question.id,
    materialId: question.materialId,
    topicKey: topicKeyOf(question.topicTitle),
    topicTitle: question.topicTitle,
    stability: next.state.stability,
    difficulty: next.state.difficulty,
    reps: next.state.reps,
    lapses: next.state.lapses,
    state: next.state.state,
    dueAt: next.state.dueAt,
    lastReviewedAt: next.state.lastReviewedAt,
    lastScorePercent: existing?.lastScorePercent ?? null,
    lastRating: rating,
  });

  return {
    nextDueAt: next.state.dueAt,
    scheduledDays: next.scheduledDays,
    intervalLabel: formatInterval(next.scheduledDays),
  };
}
