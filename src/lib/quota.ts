import { QUOTA_LIMITS, type QuotaKind } from "@/lib/config";
import { getStore } from "@/lib/db";
import type { UsageSnapshot } from "@/lib/db/types";
import { QuotaExceededError } from "@/lib/errors";
import { dayKey } from "@/lib/ids";

const KIND_LABEL: Record<QuotaKind, string> = {
  material: "上传材料",
  question: "生成题目",
  judgment: "判定次数",
  ask: "材料问答",
};

export type QuotaDecision = {
  allowed: boolean;
  usage: UsageSnapshot;
  limits: typeof QUOTA_LIMITS;
  exceeded?: QuotaKind;
};

export async function checkQuota(
  userId: string,
  cost: Partial<Record<QuotaKind, number>>,
): Promise<QuotaDecision> {
  const store = getStore();
  const usage = await store.getUsage(userId, dayKey());
  for (const [kind, amount] of Object.entries(cost) as [QuotaKind, number][]) {
    if (amount <= 0) continue;
    if (usage[kind] + amount > QUOTA_LIMITS[kind]) {
      return { allowed: false, usage, limits: QUOTA_LIMITS, exceeded: kind };
    }
  }
  return { allowed: true, usage, limits: QUOTA_LIMITS };
}

export async function assertQuota(
  userId: string,
  cost: Partial<Record<QuotaKind, number>>,
): Promise<void> {
  const decision = await checkQuota(userId, cost);
  if (!decision.allowed && decision.exceeded) {
    throw new QuotaExceededError(
      `今日${KIND_LABEL[decision.exceeded]}额度已用完（上限 ${QUOTA_LIMITS[decision.exceeded]}），明天再来或配置自己的密钥。`,
    );
  }
}

export async function recordUsage(
  userId: string,
  cost: Partial<Record<QuotaKind, number>>,
): Promise<void> {
  const store = getStore();
  const day = dayKey();
  for (const [kind, amount] of Object.entries(cost) as [QuotaKind, number][]) {
    if (amount <= 0) continue;
    await store.incrementUsage(userId, day, kind, amount);
  }
}

export async function usageSnapshot(userId: string): Promise<UsageSnapshot> {
  return getStore().getUsage(userId, dayKey());
}

/** Asia/Shanghai 没有夏令时，直接按固定偏移计算下一次重置时间。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export type QuotaResetInfo = {
  resetAt: Date;
  minutesLeft: number;
  label: string;
};

export function quotaResetInfo(now: Date = new Date()): QuotaResetInfo {
  const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const nextMidnightShanghai = Date.UTC(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate() + 1,
  );
  const resetAt = new Date(nextMidnightShanghai - SHANGHAI_OFFSET_MS);
  const minutesLeft = Math.max(0, Math.round((resetAt.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutesLeft / 60);
  return {
    resetAt,
    minutesLeft,
    label:
      minutesLeft <= 0
        ? "额度已重置"
        : hours > 0
          ? `${hours} 小时 ${minutesLeft % 60} 分钟后重置`
          : `${minutesLeft} 分钟后重置`,
  };
}

export type QuotaRow = {
  kind: QuotaKind;
  label: string;
  used: number;
  limit: number;
  ratio: number;
};

export function quotaRows(usage: UsageSnapshot): QuotaRow[] {
  const labels: Record<QuotaKind, string> = {
    material: "上传材料",
    question: "生成题目",
    judgment: "判定次数",
    ask: "材料问答",
  };
  return (Object.keys(QUOTA_LIMITS) as QuotaKind[]).map((kind) => ({
    kind,
    label: labels[kind],
    used: usage[kind],
    limit: QUOTA_LIMITS[kind],
    ratio: Math.min(1, usage[kind] / QUOTA_LIMITS[kind]),
  }));
}
