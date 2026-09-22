import { QUOTA_LIMITS, type QuotaKind } from "@/lib/config";
import { getStore } from "@/lib/db";
import type { UsageSnapshot } from "@/lib/db/types";
import { QuotaExceededError } from "@/lib/errors";
import { dayKey } from "@/lib/ids";

const KIND_LABEL: Record<QuotaKind, string> = {
  material: "上传材料",
  question: "生成题目",
  judgment: "判定次数",
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
