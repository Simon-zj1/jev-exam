import { MemoryStore } from "@/lib/db/memory";
import { setStoreForTests } from "@/lib/db";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import type { DecisionAnswer, DecisionEngine, DecisionQuestion, DecisionResult } from "@/lib/types";

export function useMemoryStore(): MemoryStore {
  const store = new MemoryStore(`test-${Math.random().toString(36).slice(2)}`);
  setStoreForTests(store);
  return store;
}

export function resetOverrides(): void {
  setDecisionEngineOverride(null);
  setGenerationProviderOverride(null);
  setStoreForTests(null);
}

/**
 * 测试用判定引擎：由回调决定每个问题的答案，方便构造“高置信 / 低置信 / 矛盾”等场景。
 */
export class FakeEngine implements DecisionEngine {
  readonly id = "fake-engine";
  readonly model = "fake-1.0.0";
  private readonly resolver: (
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
  ) => Record<string, DecisionAnswer>;
  calls = 0;

  constructor(
    resolver: (
      state: string | Record<string, unknown>,
      questions: Record<string, DecisionQuestion>,
    ) => Record<string, DecisionAnswer>,
  ) {
    this.resolver = resolver;
  }

  async decide(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
  ): Promise<DecisionResult> {
    this.calls += 1;
    return {
      engineId: this.id,
      model: this.model,
      answers: this.resolver(state, questions),
      latencyMs: 3,
      raw: { fake: true },
    };
  }
}

export function noul(probability: number): DecisionAnswer {
  return { type: "noul", noul: probability };
}

export const SAMPLE_MATERIAL = [
  "光合作用分为光反应和暗反应两个阶段。",
  "光反应发生在类囊体薄膜上，需要光照，水在光下分解产生氧气和还原型辅酶Ⅱ。",
  "光反应把光能转变成活跃的化学能并储存在ATP中。",
  "暗反应发生在叶绿体基质中，不需要光照。",
  "暗反应中二氧化碳被固定后，利用光反应产生的ATP和还原型辅酶Ⅱ还原成糖类。",
  "暗反应把活跃的化学能转变成稳定的化学能。",
  "光合作用的整体意义是把无机物合成有机物，并把光能储存在有机物中。",
  "影响光合作用速率的外界因素包括光照强度、二氧化碳浓度和温度。",
].join("\n");
