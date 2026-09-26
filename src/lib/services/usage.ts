import { DAILY_SPEND_CAP_MICRO_USD } from "@/lib/config";
import { getStore } from "@/lib/db";
import type { LlmUsageRecord } from "@/lib/db/types";
import { SpendCapExceededError } from "@/lib/errors";
import { dayKey } from "@/lib/ids";
import {
  estimateCostMicroUsd,
  formatMicroUsd,
  sumUsage,
  type ChatUsageEvent,
} from "@/lib/llm/usage";

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

export type SpendStatus = {
  usedMicroUsd: number;
  capMicroUsd: number;
  remainingMicroUsd: number;
  /** 已用比例，用于界面进度条 */
  ratio: number;
  exceeded: boolean;
};

export async function spendStatus(userId: string): Promise<SpendStatus> {
  const { total } = await todayLlmUsage(userId);
  const used = total.costMicroUsd;
  const remaining = Math.max(0, DAILY_SPEND_CAP_MICRO_USD - used);
  return {
    usedMicroUsd: used,
    capMicroUsd: DAILY_SPEND_CAP_MICRO_USD,
    remainingMicroUsd: remaining,
    ratio: Math.min(1, used / DAILY_SPEND_CAP_MICRO_USD),
    exceeded: used >= DAILY_SPEND_CAP_MICRO_USD,
  };
}

/**
 * 调用模型前的消费闸门。只拦「平台 Key」的调用：
 * BYOK 花的是用户自己的钱，平台没有理由替他设上限（他可以在服务商侧设）。
 */
export async function assertWithinSpendCap(userId: string): Promise<void> {
  const status = await spendStatus(userId);
  if (!status.exceeded) return;
  throw new SpendCapExceededError(
    `今日模型消费已达上限（估算 ${formatMicroUsd(status.usedMicroUsd)} / ${formatMicroUsd(
      status.capMicroUsd,
    )}），明天重置；配置自己的密钥（BYOK）不受此限制。`,
  );
}
