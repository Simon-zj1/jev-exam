import type { ByokConfig } from "@/lib/byok";
import { resolveByokChatProvider } from "@/lib/engine";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { LlmGenerationProvider } from "@/lib/generator/llm";
import type { GenerationProvider } from "@/lib/generator/provider";
import { resolvePlatformChatProvider } from "@/lib/llm/provider";

export type GenerationSelection = {
  provider: GenerationProvider;
  mode: "byok" | "platform" | "offline";
  /** 是否计入平台额度：byok / offline 不计 */
  countsAgainstQuota: boolean;
};

export type GenerationContext = {
  byok?: ByokConfig | null;
  override?: GenerationProvider | null;
};

let globalOverride: GenerationProvider | null = null;

/** 测试/评测专用：强制所有出题走同一个 provider。 */
export function setGenerationProviderOverride(provider: GenerationProvider | null): void {
  globalOverride = provider;
}

/**
 * 出题模型选择顺序：
 * 1. 用户自带 LLM key
 * 2. 平台 LLM key
 * 3. 离线确定性出题器（仅演示 / 测试）
 */
export function resolveGenerationProvider(context: GenerationContext = {}): GenerationSelection {
  if (context.override) {
    return { provider: context.override, mode: "offline", countsAgainstQuota: false };
  }
  if (globalOverride) {
    return { provider: globalOverride, mode: "offline", countsAgainstQuota: false };
  }

  const byokProvider = resolveByokChatProvider(context.byok);
  if (byokProvider) {
    return {
      provider: new LlmGenerationProvider(byokProvider),
      mode: "byok",
      countsAgainstQuota: false,
    };
  }

  const platformProvider = resolvePlatformChatProvider();
  if (platformProvider) {
    return {
      provider: new LlmGenerationProvider(platformProvider),
      mode: "platform",
      countsAgainstQuota: true,
    };
  }

  return {
    provider: new HeuristicGenerationProvider(),
    mode: "offline",
    countsAgainstQuota: false,
  };
}

export type { GenerationProvider } from "@/lib/generator/provider";
