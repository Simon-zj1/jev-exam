import { describe, expect, it } from "vitest";
import {
  createReviewState,
  formatInterval,
  intervalForRetention,
  ratingFromScore,
  retrievability,
  scheduleReview,
  type ReviewState,
} from "@/lib/fsrs";

const NOW = new Date("2026-09-26T00:00:00.000Z");

describe("FSRS 调度器", () => {
  it("可提取概率在到期时约等于目标保留率 0.9", () => {
    const stability = 10;
    const interval = intervalForRetention(stability);
    expect(interval).toBe(10);
    expect(retrievability(interval, stability)).toBeCloseTo(0.9, 1);
  });

  it("新卡按评分给出不同初始间隔：Again 当天再来，Easy 间隔最长", () => {
    const again = createReviewState(1, NOW);
    const good = createReviewState(3, NOW);
    const easy = createReviewState(4, NOW);

    expect(again.state).toBe("learning");
    // 新错题立刻进入今日队列
    expect(again.dueAt.getTime()).toBe(NOW.getTime());
    expect(good.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(easy.stability).toBeGreaterThan(good.stability);
    expect(intervalForRetention(easy.stability)).toBeGreaterThanOrEqual(
      intervalForRetention(good.stability),
    );
  });

  it("连续答对时稳定度单调上升，间隔越来越长", () => {
    let state: ReviewState = createReviewState(3, NOW);
    const intervals: number[] = [];
    let cursor = state.dueAt;

    for (let i = 0; i < 4; i += 1) {
      const result = scheduleReview(state, 3, cursor);
      intervals.push(result.scheduledDays);
      state = result.state;
      cursor = state.dueAt;
    }

    expect(state.stability).toBeGreaterThan(1);
    expect(intervals.every((value, index) => index === 0 || value >= intervals[index - 1])).toBe(true);
    expect(intervals[intervals.length - 1]).toBeGreaterThan(intervals[0]);
  });

  it("选择 Again 会降低稳定度、增加遗忘次数，并要求当天重来", () => {
    const learned = createReviewState(3, NOW);
    const later = new Date(learned.dueAt.getTime() + 5 * 24 * 60 * 60 * 1000);
    const failed = scheduleReview(learned, 1, later);

    expect(failed.state.lapses).toBe(1);
    expect(failed.state.stability).toBeLessThanOrEqual(learned.stability);
    expect(failed.state.state).toBe("relearning");
    expect(failed.state.dueAt.getTime() - later.getTime()).toBeLessThan(60 * 60 * 1000);
  });

  it("难度始终被夹在 1..10", () => {
    let state = createReviewState(1, NOW);
    for (let i = 0; i < 10; i += 1) {
      state = scheduleReview(state, 1, new Date(NOW.getTime() + i * 3600_000)).state;
    }
    expect(state.difficulty).toBeLessThanOrEqual(10);
    expect(state.difficulty).toBeGreaterThanOrEqual(1);
  });

  it("判定分数映射到四档评分", () => {
    expect(ratingFromScore(0)).toBe(1);
    expect(ratingFromScore(49)).toBe(1);
    expect(ratingFromScore(60)).toBe(2);
    expect(ratingFromScore(80)).toBe(3);
    expect(ratingFromScore(100)).toBe(4);
  });

  it("间隔描述对人类可读", () => {
    expect(formatInterval(0)).toBe("10 分钟后");
    expect(formatInterval(5)).toBe("5 天后");
    expect(formatInterval(60)).toBe("2 个月后");
    expect(formatInterval(400)).toBe("1 年后");
  });
});
