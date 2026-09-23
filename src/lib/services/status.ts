import { resolveDecisionEngine } from "@/lib/engine";
import { resolveGenerationProvider } from "@/lib/generator";
import { resolveGenerationConfig, type ProviderKind } from "@/lib/llm/provider";

export type EngineStatus = {
  judgeEngine: string;
  judgeMode: "byok" | "platform" | "offline";
  generator: string;
  generatorMode: "byok" | "platform" | "offline";
  demoMode: boolean;
  judgeLabel: string;
  generatorLabel: string;
  /** 出题模型的配置来源与识别结果，用于界面提示与排错 */
  generatorModel: string | null;
  generatorSource: "PLATFORM_LLM_API_KEY" | "AI_API_KEY" | null;
  generatorProvider: ProviderKind | null;
  generatorDetectedFromKey: boolean;
};

const JUDGE_LABEL: Record<string, string> = {
  typesafe: "TypeSafe Jev",
  "llm-judge": "LLM 判定（对比基线）",
  "lexical-demo": "离线词面判定（演示）",
};

const GENERATOR_LABEL: Record<string, string> = {
  "llm-generator": "大模型出题",
  "offline-heuristic": "离线启发式出题（演示）",
};

export function engineStatus(): EngineStatus {
  const judge = resolveDecisionEngine({});
  const generator = resolveGenerationProvider({});
  const config = resolveGenerationConfig();
  return {
    judgeEngine: judge.engine.id,
    judgeMode: judge.mode,
    generator: generator.provider.id,
    generatorMode: generator.mode,
    demoMode: judge.mode === "offline" || generator.mode === "offline",
    judgeLabel: JUDGE_LABEL[judge.engine.id] ?? judge.engine.id,
    generatorLabel: GENERATOR_LABEL[generator.provider.id] ?? generator.provider.id,
    generatorModel: config?.model ?? null,
    generatorSource: config?.source === "none" ? null : (config?.source ?? null),
    generatorProvider: config?.kind ?? null,
    generatorDetectedFromKey: config?.detected ?? false,
  };
}
