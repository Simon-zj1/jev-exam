/**
 * FSRS（Free Spaced Repetition Scheduler）调度器。
 *
 * 为什么自己实现：间隔重复的有效性取决于参数与状态机是否可解释、可测试，
 * 而我们要把「判定结果」直接映射成复习评分，需要一个能读懂的实现。
 * 这里采用 FSRS-5 的公式与默认权重（19 个参数），目标保留率 0.9。
 *
 * 评分沿用 FSRS 的四档语义：1=Again 完全不会 / 2=Hard 有点难 / 3=Good 记得 / 4=Easy 太简单。
 */

export type ReviewRating = 1 | 2 | 3 | 4;

export type ReviewState = {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: "new" | "learning" | "review" | "relearning";
  /** 上次复习时间；新卡为 null */
  lastReviewedAt: Date | null;
  /** 下次到期时间 */
  dueAt: Date;
};

/** FSRS-5 默认权重 */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // 使 R(S, S) = 0.9
const DESIRED_RETENTION = 0.9;
const MIN_STABILITY = 0.01;
const MAX_INTERVAL_DAYS = 365 * 5;

export function clampDifficulty(value: number): number {
  return Math.min(10, Math.max(1, value));
}

/** 记忆可提取概率：R(t, S) */
export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + (FACTOR * t) / stability, DECAY);
}

/** 给定稳定度与目标保留率，反解间隔天数 */
export function intervalForRetention(stability: number, retention = DESIRED_RETENTION): number {
  const raw = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(raw)));
}

function initialStability(rating: ReviewRating, weights: readonly number[]): number {
  return Math.max(MIN_STABILITY, weights[rating - 1]);
}

function initialDifficulty(rating: ReviewRating, weights: readonly number[]): number {
  return clampDifficulty(weights[4] - (rating - 3) * weights[5]);
}

function nextDifficulty(difficulty: number, rating: ReviewRating, weights: readonly number[]): number {
  const delta = difficulty - weights[6] * (rating - 3);
  const reverted = weights[7] * initialDifficulty(4, weights) + (1 - weights[7]) * delta;
  return clampDifficulty(reverted);
}

function stabilityAfterRecall(
  difficulty: number,
  stability: number,
  retrievabilityNow: number,
  rating: ReviewRating,
  weights: readonly number[],
): number {
  const hardPenalty = rating === 2 ? weights[15] : 1;
  const easyBonus = rating === 4 ? weights[16] : 1;
  const growth =
    1 +
    Math.exp(weights[8]) *
      (11 - difficulty) *
      Math.pow(stability, -weights[9]) *
      (Math.exp(weights[10] * (1 - retrievabilityNow)) - 1) *
      hardPenalty *
      easyBonus;
  return Math.max(MIN_STABILITY, stability * growth);
}

function stabilityAfterForgetting(
  difficulty: number,
  stability: number,
  retrievabilityNow: number,
  weights: readonly number[],
): number {
  const next =
    weights[11] *
    Math.pow(difficulty, -weights[12]) *
    (Math.pow(stability + 1, weights[13]) - 1) *
    Math.exp(weights[14] * (1 - retrievabilityNow));
  return Math.max(MIN_STABILITY, Math.min(next, stability));
}

function shortTermStability(stability: number, rating: ReviewRating, weights: readonly number[]): number {
  const next = stability * Math.exp(weights[17] * (rating - 3 + weights[18]));
  return Math.max(MIN_STABILITY, next);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * 新卡首次评分：直接给初始稳定度/难度，并把到期时间排到 1 天后（Again 当天再来）。
 */
export function createReviewState(
  rating: ReviewRating,
  now: Date = new Date(),
  weights: readonly number[] = DEFAULT_WEIGHTS,
): ReviewState {
  const stability = initialStability(rating, weights);
  const difficulty = initialDifficulty(rating, weights);
  const intervalDays = intervalForRetention(stability);
  // 新卡的「完全不会」立刻进入今天的复习队列（交卷后马上能看到待复习数量）；
  // 之后在复习里再次失败才会排到 10 分钟后。
  const dueAt = rating === 1 ? now : addDays(now, intervalDays);
  return {
    stability,
    difficulty,
    reps: 1,
    lapses: rating === 1 ? 1 : 0,
    state: rating === 1 ? "learning" : "review",
    lastReviewedAt: now,
    dueAt,
  };
}

export type ScheduleResult = {
  state: ReviewState;
  /** 本次复习距离上次的天数（新卡为 0） */
  elapsedDays: number;
  /** 本次排期的间隔天数 */
  scheduledDays: number;
};

/**
 * 已有卡片按评分推进：区分「回忆成功」与「遗忘」两条更新路径，
 * 同一天内的重复复习走短期稳定度路径（FSRS-5 的行为）。
 */
export function scheduleReview(
  previous: ReviewState,
  rating: ReviewRating,
  now: Date = new Date(),
  weights: readonly number[] = DEFAULT_WEIGHTS,
): ScheduleResult {
  const lastReview = previous.lastReviewedAt ?? now;
  const elapsedDays = Math.max(0, (now.getTime() - lastReview.getTime()) / (24 * 60 * 60 * 1000));
  const retrievabilityNow = retrievability(elapsedDays, previous.stability);

  let stability: number;
  let lapses = previous.lapses;
  let state: ReviewState["state"] = previous.state === "new" ? "learning" : previous.state;

  if (rating === 1) {
    stability = stabilityAfterForgetting(previous.difficulty, previous.stability, retrievabilityNow, weights);
    lapses += 1;
    state = "relearning";
  } else {
    stability = stabilityAfterRecall(previous.difficulty, previous.stability, retrievabilityNow, rating, weights);
    if (elapsedDays < 1) stability = shortTermStability(stability, rating, weights);
    state = "review";
  }

  const difficulty = nextDifficulty(previous.difficulty, rating, weights);
  const scheduledDays = rating === 1 ? 0 : intervalForRetention(stability);
  const dueAt = rating === 1 ? new Date(now.getTime() + 10 * 60 * 1000) : addDays(now, scheduledDays);

  return {
    state: {
      stability,
      difficulty,
      reps: previous.reps + 1,
      lapses,
      state,
      lastReviewedAt: now,
      dueAt,
    },
    elapsedDays,
    scheduledDays,
  };
}

/**
 * 把判定结果映射成复习评分。
 * 这样学习者不需要自己判断「我是得了 3 分还是 4 分」，评分由判定链路给出；
 * 界面仍允许手动覆盖（例如手写作答只能自评）。
 */
export function ratingFromScore(scorePercent: number): ReviewRating {
  if (scorePercent < 50) return 1;
  if (scorePercent < 75) return 2;
  if (scorePercent < 95) return 3;
  return 4;
}

export const RATING_LABEL: Record<ReviewRating, string> = {
  1: "完全不会",
  2: "有点难",
  3: "记得",
  4: "太简单",
};

/** 人类可读的间隔描述，用于界面反馈 */
export function formatInterval(days: number): string {
  if (days <= 0) return "10 分钟后";
  if (days < 30) return `${days} 天后`;
  if (days < 365) return `${Math.round(days / 30)} 个月后`;
  const years = days / 365;
  return `${years < 1.5 ? "1" : Math.round(years)} 年后`;
}
