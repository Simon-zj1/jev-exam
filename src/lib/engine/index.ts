import type { ByokConfig } from "@/lib/byok";
import { LexicalJudgeEngine } from "@/lib/engine/lexical";
import { LLMJudgeEngine } from "@/lib/engine/llm-judge";
import { TypeSafeEngine } from "@/lib/engine/typesafe";
import { resolveChatProvider, resolvePlatformChatProvider } from "@/lib/llm/provider";
import type { DecisionEngine } from "@/lib/types";

export type EngineMode = "byok" | "platform" | "offline";

export type EngineSelection = {
  engine: DecisionEngine;
  mode: EngineMode;
  /** 是否计入平台额度：byok 不计 */
  countsAgainstQuota: boolean;
};

export type EngineContext = {
  byok?: ByokConfig | null;
  /** 测试注入 */
  override?: DecisionEngine | null;
};

let globalOverride: DecisionEngine | null = null;

/** 测试/评测专用：强制所有判定走同一个引擎。 */
export function setDecisionEngineOverride(engine: DecisionEngine | null): void {
  globalOverride = engine;
}

/**
 * 引擎选择顺序：
 * 1. 用户自带 Jev key（BYOK）
 * 2. 平台 TYPESAFE_API_KEY
 * 3. 平台出题模型的 LLM 判定（降级，供对比）
 * 4. 离线词面判定（仅演示，无任何密钥时）
 */
export function resolveDecisionEngine(context: EngineContext = {}): EngineSelection {
  if (context.override) {
    return { engine: context.override, mode: "offline", countsAgainstQuota: false };
  }
  if (globalOverride) {
    return { engine: globalOverride, mode: "offline", countsAgainstQuota: false };
  }

  const judge = context.byok?.judge;
  if (judge?.apiKey) {
    return {
      engine: new TypeSafeEngine({
        apiKey: judge.apiKey,
        baseUrl: judge.baseUrl,
        model: judge.model,
      }),
      mode: "byok",
      countsAgainstQuota: false,
    };
  }

  const platform = TypeSafeEngine.fromEnv();
  if (platform) {
    return { engine: platform, mode: "platform", countsAgainstQuota: true };
  }

  const chatProvider = resolvePlatformChatProvider();
  if (chatProvider) {
    return {
      engine: new LLMJudgeEngine(chatProvider),
      mode: "platform",
      countsAgainstQuota: true,
    };
  }

  return { engine: new LexicalJudgeEngine(), mode: "offline", countsAgainstQuota: false };
}

/** 用户自带出题模型。 */
export function resolveByokChatProvider(byok?: ByokConfig | null) {
  const llm = byok?.llm;
  if (!llm?.apiKey) return null;
  return resolveChatProvider(llm).provider;
}

export { LexicalJudgeEngine, LLMJudgeEngine, TypeSafeEngine };
