import { z } from "zod";
import type { ChatProvider } from "@/lib/llm/provider";
import {
  DecisionEngineError,
  type DecisionAnswer,
  type DecisionEngine,
  type DecisionQuestion,
  type DecisionResult,
} from "@/lib/types";

const answerSchema = z.object({
  type: z.enum(["noul", "choice", "score"]),
  noul: z.number().min(0).max(1).optional(),
  choice: z.string().optional(),
  score: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const payloadSchema = z.object({ answers: z.record(z.string(), answerSchema) });

export const LLM_JUDGE_SYSTEM_PROMPT = [
  "你是一个判定器：只做类型化的概率判断，不写解释、不写散文。",
  "输入包含 state（被判定材料）与 questions（一组问题）。",
  "对每个问题返回一个答案对象：",
  '- noul：{"type":"noul","noul":0..1}，表示命题为真的概率。',
  '- choice：{"type":"choice","choice":"选项键","confidence":0..1,"probabilities":{...}}。',
  '- score：{"type":"score","score":数值,"confidence":0..1}。',
  "只输出 JSON，形状为 {\"answers\":{\"问题键\":答案对象}}，不要输出任何其它文字。",
  "不要做算术推导；如果问题要求计算，直接基于给定文本判断其结论是否成立。",
].join("\n");

/**
 * 用普通 LLM 模拟 System One 判定，作为 Jev 的对比基线 / 兜底实现。
 * 与 Jev 的差异：输出不是原生并行采样，校准性更差，只用于对比与降级。
 */
export class LLMJudgeEngine implements DecisionEngine {
  readonly id = "llm-judge";
  readonly model: string;
  private readonly provider: ChatProvider;

  constructor(provider: ChatProvider) {
    this.provider = provider;
    this.model = provider.model;
  }

  async decide(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
    options?: { signal?: AbortSignal },
  ): Promise<DecisionResult> {
    const keys = Object.keys(questions);
    const startedAt = Date.now();
    if (keys.length === 0) {
      return { engineId: this.id, model: this.model, answers: {}, latencyMs: 0, raw: null };
    }

    const user = JSON.stringify(
      {
        state,
        questions,
      },
      null,
      2,
    );

    const response = await this.provider.complete({
      system: LLM_JUDGE_SYSTEM_PROMPT,
      user,
      json: true,
      temperature: 0,
      signal: options?.signal,
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.text);
    } catch (error) {
      throw new DecisionEngineError("LLM 判定输出不是合法 JSON", {
        engineId: this.id,
        retryable: true,
        cause: error,
      });
    }

    const parsed = payloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new DecisionEngineError(`LLM 判定输出结构不合法：${parsed.error.message}`, {
        engineId: this.id,
        retryable: true,
      });
    }

    const answers: Record<string, DecisionAnswer> = {};
    const missing: string[] = [];

    for (const key of keys) {
      const raw = parsed.data.answers[key];
      if (!raw) {
        missing.push(key);
        continue;
      }
      if (raw.type === "noul" && typeof raw.noul === "number") {
        answers[key] = { type: "noul", noul: raw.noul };
      } else if (raw.type === "choice" && typeof raw.choice === "string") {
        answers[key] = {
          type: "choice",
          choice: raw.choice,
          confidence: raw.confidence ?? 0,
          probabilities: raw.probabilities ?? {},
        };
      } else if (raw.type === "score" && typeof raw.score === "number") {
        answers[key] = {
          type: "score",
          score: raw.score,
          confidence: raw.confidence ?? 0,
          probabilities: raw.probabilities,
        };
      } else {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new DecisionEngineError(`LLM 判定缺少答案：${missing.join(", ")}`, {
        engineId: this.id,
        retryable: true,
      });
    }

    return {
      engineId: this.id,
      model: response.model,
      answers,
      latencyMs: Date.now() - startedAt,
      usage: response.usage,
      raw: parsedJson,
    };
  }
}
