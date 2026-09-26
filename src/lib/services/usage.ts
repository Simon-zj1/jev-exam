import { getStore } from "@/lib/db";
import type { LlmUsageRecord } from "@/lib/db/types";
import { dayKey } from "@/lib/ids";
import { estimateCostMicroUsd, sumUsage, type ChatUsageEvent } from "@/lib/llm/usage";

/**
 * 把一次请求里发生的模型调用按「模型」聚合后落库。
 *
 * 聚合而不是逐条写：一次出题可能调 3 次模型，逐条写会放大写库次数，
 * 而这里的用途是看每天烧掉多少钱，按模型汇总已经够用。
 */
export async function recordChatUsage(userId: string, events: ChatUsageEvent[]): Promise<void> {
  if (events.length === 0) return;

  const aggregated = new Map<
    string,
    { calls: number; inputTokens: number; outputTokens: number; costMicroUsd: number }
  >();

  for (const event of events) {
    const current = aggregated.get(event.model) ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
    };
    current.calls += 1;
    current.inputTokens += event.inputTokens ?? 0;
    current.outputTokens += event.outputTokens ?? 0;
    current.costMicroUsd += estimateCostMicroUsd(
      event.model,
      event.inputTokens,
      event.outputTokens,
    );
    aggregated.set(event.model, current);
  }

  const store = getStore();
  const day = dayKey();
  for (const [model, delta] of aggregated) {
    await store.incrementLlmUsage(userId, day, model, delta);
  }
}

export type TodayUsage = {
  day: string;
  total: LlmUsageRecord;
  byModel: LlmUsageRecord[];
};

export async function todayLlmUsage(userId: string): Promise<TodayUsage> {
  const day = dayKey();
  const byModel = await getStore().listLlmUsage(userId, day);
  return { day, total: sumUsage(byModel), byModel };
}
