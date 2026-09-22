import { env } from "@/lib/env";
import {
  DecisionEngineError,
  type DecisionAnswer,
  type DecisionEngine,
  type DecisionQuestion,
  type DecisionResult,
} from "@/lib/types";

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";

export type TypeSafeEngineOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** 把 TypeSafe 返回的单个答案归一化成内部联合类型；无法识别时返回 null。 */
function parseAnswer(key: string, raw: unknown): DecisionAnswer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const type = record.type;

  if (type === "noul") {
    const value = Number(record.noul);
    if (!Number.isFinite(value)) return null;
    return { type: "noul", noul: clamp01(value) };
  }

  if (type === "choice") {
    const choice = record.choice;
    if (typeof choice !== "string") return null;
    const probabilities: Record<string, number> = {};
    if (record.probabilities && typeof record.probabilities === "object") {
      for (const [option, value] of Object.entries(record.probabilities as Record<string, unknown>)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) probabilities[option] = clamp01(numeric);
      }
    }
    return {
      type: "choice",
      choice,
      confidence: clamp01(Number(record.confidence ?? 0)),
      probabilities,
    };
  }

  if (type === "score") {
    const score = Number(record.score);
    if (!Number.isFinite(score)) return null;
    const probabilities: Record<string, number> = {};
    if (record.probabilities && typeof record.probabilities === "object") {
      for (const [level, value] of Object.entries(record.probabilities as Record<string, unknown>)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) probabilities[level] = clamp01(numeric);
      }
    }
    return {
      type: "score",
      score,
      confidence: clamp01(Number(record.confidence ?? 0)),
      legend:
        record.legend && typeof record.legend === "object"
          ? (record.legend as Record<string, string>)
          : undefined,
      probabilities: Object.keys(probabilities).length > 0 ? probabilities : undefined,
    };
  }

  // 少数情况下模型可能省略 type，但给出 noul 字段。
  if (typeof record.noul === "number") {
    void key;
    return { type: "noul", noul: clamp01(record.noul) };
  }

  return null;
}

export class TypeSafeEngine implements DecisionEngine {
  readonly id = "typesafe";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TypeSafeEngineOptions) {
    if (!options.apiKey) throw new Error("TypeSafeEngine 需要 apiKey");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  static fromEnv(): TypeSafeEngine | null {
    const apiKey = env("TYPESAFE_API_KEY");
    if (!apiKey) return null;
    return new TypeSafeEngine({
      apiKey,
      baseUrl: env("TYPESAFE_BASE_URL"),
      model: env("TYPESAFE_MODEL"),
    });
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, model: this.model, questions }),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new DecisionEngineError(
          `TypeSafe 返回 ${response.status}：${text.slice(0, 300)}`,
          {
            engineId: this.id,
            status: response.status,
            retryable: response.status >= 500 || response.status === 429,
          },
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new DecisionEngineError("TypeSafe 返回的不是合法 JSON", {
          engineId: this.id,
          retryable: true,
          cause: error,
        });
      }

      const body = payload as {
        model?: string;
        answers?: Record<string, unknown>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const rawAnswers = body.answers ?? {};
      const answers: Record<string, DecisionAnswer> = {};
      const missing: string[] = [];

      for (const key of keys) {
        const answer = parseAnswer(key, rawAnswers[key]);
        if (answer) answers[key] = answer;
        else missing.push(key);
      }

      if (missing.length > 0) {
        throw new DecisionEngineError(`TypeSafe 缺少或无法解析的答案：${missing.join(", ")}`, {
          engineId: this.id,
          retryable: true,
        });
      }

      return {
        engineId: this.id,
        model: body.model ?? this.model,
        answers,
        latencyMs: Date.now() - startedAt,
        usage: body.usage
          ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens }
          : undefined,
        raw: payload,
      };
    } catch (error) {
      if (error instanceof DecisionEngineError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new DecisionEngineError(
        aborted ? "TypeSafe 调用超时" : `TypeSafe 调用失败：${(error as Error).message}`,
        { engineId: this.id, retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
    }
  }
}
