import { resolveDecisionEngine } from "@/lib/engine";
import { resolveGenerationProvider } from "@/lib/generator";

export type EngineStatus = {
  judgeEngine: string;
  judgeMode: "byok" | "platform" | "offline";
  generator: string;
  generatorMode: "byok" | "platform" | "offline";
  demoMode: boolean;
  judgeLabel: string;
  generatorLabel: string;
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
  return {
    judgeEngine: judge.engine.id,
    judgeMode: judge.mode,
    generator: generator.provider.id,
    generatorMode: generator.mode,
    demoMode: judge.mode === "offline" || generator.mode === "offline",
    judgeLabel: JUDGE_LABEL[judge.engine.id] ?? judge.engine.id,
    generatorLabel: GENERATOR_LABEL[generator.provider.id] ?? generator.provider.id,
  };
}
