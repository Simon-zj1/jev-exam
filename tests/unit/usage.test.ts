import { describe, expect, it } from "vitest";
import { DAILY_SPEND_CAP_MICRO_USD } from "@/lib/config";
import {
  DEFAULT_PRICE,
  estimateCostMicroUsd,
  formatMicroUsd,
  priceFor,
  sumUsage,
} from "@/lib/llm/usage";

describe("模型成本估算", () => {
  it("按公开价折算，用微美元整数存放", () => {
    // gpt-4o-mini：输入 $0.15/1M，10 万输入 token ≈ $0.015
    const cost = estimateCostMicroUsd("gpt-4o-mini", 100_000, 0);
    expect(cost).toBe(15_000);
    expect(Number.isInteger(cost)).toBe(true);
  });

  it("带日期后缀的模型名按前缀匹配价格", () => {
    expect(priceFor("deepseek-chat-2026-01-01")).toEqual(priceFor("deepseek-chat"));
  });

  it("未知模型用偏高的默认价，宁可高估成本", () => {
    expect(priceFor("某不存在的模型")).toEqual(DEFAULT_PRICE);
    expect(estimateCostMicroUsd("某不存在的模型", 1_000_000, 0)).toBe(1_000_000);
  });

  it("缺少 usage 时按 0 计，不抛错", () => {
    expect(estimateCostMicroUsd("gpt-4o-mini", undefined, undefined)).toBe(0);
  });

  it("金额格式化区分零、极小与常规", () => {
    expect(formatMicroUsd(0)).toBe("$0");
    expect(formatMicroUsd(1_500)).toBe("$0.0015");
    expect(formatMicroUsd(1_500_000)).toBe("$1.50");
  });

  it("汇总多个模型", () => {
    const total = sumUsage([
      { model: "a", calls: 2, inputTokens: 100, outputTokens: 50, costMicroUsd: 10 },
      { model: "b", calls: 1, inputTokens: 200, outputTokens: 80, costMicroUsd: 20 },
    ]);
    expect(total.calls).toBe(3);
    expect(total.inputTokens).toBe(300);
    expect(total.outputTokens).toBe(130);
    expect(total.costMicroUsd).toBe(30);
  });

  it("消费上限有一个正的默认值（否则闸门形同虚设）", () => {
    expect(DAILY_SPEND_CAP_MICRO_USD).toBeGreaterThan(0);
  });
});
