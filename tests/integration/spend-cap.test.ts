import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginWithInvite } from "@/lib/auth/session";
import { DAILY_SPEND_CAP_MICRO_USD, PLATFORM_DAILY_SPEND_CAP_MICRO_USD } from "@/lib/config";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { setChatProviderOverride } from "@/lib/llm/provider";
import { SpendCapExceededError } from "@/lib/errors";
import { createExamForMaterial, generateOutlineForMaterial } from "@/lib/services/generation";
import { createMaterialForUser } from "@/lib/services/materials";
import {
  assertWithinSpendCap,
  platformSpendStatus,
  recordChatUsage,
  spendStatus,
} from "@/lib/services/usage";
import { FakeChatProvider, FakeEngine, SAMPLE_MATERIAL, noul, resetOverrides, useMemoryStore } from "../helpers";

describe("模型消费上限", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];

  beforeEach(async () => {
    store = useMemoryStore();
    await store.upsertInviteCode("SPEND-CODE", 10);
    user = (await loginWithInvite("spender@example.com", "SPEND-CODE")).user;
  });

  afterEach(() => resetOverrides());

  it("未消费时可放行，并报出剩余额度", async () => {
    const status = await spendStatus(user.id);
    expect(status.exceeded).toBe(false);
    expect(status.usedMicroUsd).toBe(0);
    expect(status.remainingMicroUsd).toBe(DAILY_SPEND_CAP_MICRO_USD);
    await expect(assertWithinSpendCap(user.id)).resolves.toBeUndefined();
  });

  it("平台级熔断：合计用量由所有用户汇总，单人没超也会被拦住", async () => {
    // 另一个用户花掉接近平台预算的钱（模拟「很多用户各花一点」）
    await recordChatUsage("someone-else", [
      { model: "gpt-4o", inputTokens: 4_000_000, outputTokens: 0 },
    ]);

    // 当前用户自己一分钱没花
    const own = await spendStatus(user.id);
    expect(own.exceeded).toBe(false);

    const platform = await platformSpendStatus();
    expect(platform.capMicroUsd).toBe(PLATFORM_DAILY_SPEND_CAP_MICRO_USD);
    expect(platform.exceeded).toBe(true);

    // 所以个人没超，也会被平台闸门拦住
    await expect(assertWithinSpendCap(user.id)).rejects.toBeInstanceOf(SpendCapExceededError);
  });

  it("达到上限后拒绝发起新的模型调用", async () => {
    // 用一个贵模型把预算一次烧掉
    await recordChatUsage(user.id, [
      { model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 },
    ]);

    const status = await spendStatus(user.id);
    expect(status.exceeded).toBe(true);
    expect(status.ratio).toBe(1);
    await expect(assertWithinSpendCap(user.id)).rejects.toBeInstanceOf(SpendCapExceededError);
  });

  it("出题链路上真的挂了闸门，而不只是定义了一个没人调用的函数", async () => {
    // 把注入的出题器标记为「算平台额度」，这样它就会走到额度与消费上限两道闸门
    setGenerationProviderOverride(new HeuristicGenerationProvider(), { countsAgainstQuota: true });
    const material = await createMaterialForUser(user, {
      title: "预算材料",
      rawText: SAMPLE_MATERIAL,
    });

    // 未超预算：正常放行
    await expect(
      generateOutlineForMaterial(user, material.id, { topicCount: 3 }),
    ).resolves.toBeDefined();

    // 把预算烧掉之后，同样的调用会被消费上限拦住
    await recordChatUsage(user.id, [
      { model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 },
    ]);
    await expect(
      generateOutlineForMaterial(user, material.id, { topicCount: 3 }),
    ).rejects.toBeInstanceOf(SpendCapExceededError);
  });

  it("BYOK 不受平台消费上限约束", async () => {
    await recordChatUsage(user.id, [
      { model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 },
    ]);
    setChatProviderOverride(new FakeChatProvider(() => "ok"), { countsAgainstQuota: false });
    setDecisionEngineOverride(
      new FakeEngine((_state, questions) => {
        const answers: Record<string, ReturnType<typeof noul>> = {};
        for (const key of Object.keys(questions)) answers[key] = noul(0.9);
        return answers;
      }),
    );

    setGenerationProviderOverride(new HeuristicGenerationProvider());
    const material = await createMaterialForUser(user, {
      title: "BYOK 材料",
      rawText: SAMPLE_MATERIAL,
    });
    await generateOutlineForMaterial(user, material.id, { topicCount: 3 });
    const exam = await createExamForMaterial(user, {
      materialId: material.id,
      topicIds: [],
      count: 4,
      mix: { mcq: 2, true_false: 1, cloze: 1 },
    });
    // countsAgainstQuota=false 代表自带密钥：花的是用户自己的钱，不受平台上限约束
    expect(exam.exam.id).toBeTruthy();
  });
});
