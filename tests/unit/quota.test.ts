import { afterEach, describe, expect, it } from "vitest";
import { QUOTA_LIMITS } from "@/lib/config";
import { QuotaExceededError } from "@/lib/errors";
import { dayKey } from "@/lib/ids";
import { assertQuota, checkQuota, recordUsage, usageSnapshot } from "@/lib/quota";
import { resetOverrides, useMemoryStore } from "../helpers";

afterEach(() => resetOverrides());

describe("每日额度", () => {
  it("按 kind 累计并允许范围内的消耗", async () => {
    useMemoryStore();
    const userId = "usr_1";

    await recordUsage(userId, { material: 1, question: 4 });
    const snapshot = await usageSnapshot(userId);
    expect(snapshot.material).toBe(1);
    expect(snapshot.question).toBe(4);

    await expect(assertQuota(userId, { question: 1 })).resolves.toBeUndefined();
  });

  it("超限时抛出 429 并指出是哪一类额度", async () => {
    useMemoryStore();
    const userId = "usr_2";
    await recordUsage(userId, { material: QUOTA_LIMITS.material });

    const decision = await checkQuota(userId, { material: 1 });
    expect(decision.allowed).toBe(false);
    expect(decision.exceeded).toBe("material");

    const error = await assertQuota(userId, { material: 1 }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect((error as QuotaExceededError).status).toBe(429);
  });

  it("跨自然日重置（按 Asia/Shanghai 计算日期键）", async () => {
    const store = useMemoryStore();
    const userId = "usr_3";
    await store.incrementUsage(userId, "2026-09-22", "question", 50);
    await recordUsage(userId, { question: 5 });

    const today = dayKey();
    expect(today).not.toBe("2026-09-22");
    expect((await usageSnapshot(userId)).question).toBe(5);
  });
});
