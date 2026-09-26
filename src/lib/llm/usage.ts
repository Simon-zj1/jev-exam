import type { LlmUsageRecord } from "@/lib/db/types";
import type { ChatProvider, ChatRequest, ChatResponse } from "@/lib/llm/provider";

/**
 * 模型调用的计量。
 *
 * 目的是回答一个运营问题：一个人一天能烧掉多少钱。做成分档配额回答不了这个问题，
 * 因为「一次出题」和「一次提问」的 token 差一个数量级。
 *
 * 价格写成「每百万 token 多少美元」，换算时统一用微美元整数累加。
 * 价格随时会变，所以这里算的是**估算值**，用于看趋势与设上限，不当账单。
 */

export type PricePerMillion = { input: number; output: number };

/** 常见模型的公开价（USD / 1M tokens）；未列出的用 defaultPrice。 */
export const MODEL_PRICES: Record<string, PricePerMillion> = {
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "glm-4.6": { input: 0.6, output: 2.2 },
  "glm-4.5-air": { input: 0.2, output: 1.1 },
  "qwen-plus": { input: 0.4, output: 1.2 },
  "qwen-max": { input: 1.6, output: 6.4 },
  "qwen-turbo": { input: 0.05, output: 0.2 },
  "moonshot-v1-32k": { input: 3.4, output: 3.4 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

/** 未收录模型的价格：取一个偏高的值，宁可高估成本也不要低估。 */
export const DEFAULT_PRICE: PricePerMillion = { input: 1, output: 3 };

export function priceFor(model: string): PricePerMillion {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  // 带日期后缀或 provider 前缀的模型名，按前缀匹配已知价格
  const normalized = model.toLowerCase();
  const hit = Object.keys(MODEL_PRICES).find((key) => normalized.startsWith(key));
  return hit ? MODEL_PRICES[hit] : DEFAULT_PRICE;
}

/** 换算成微美元（1e-6 USD），整数累加避免浮点漂移。 */
export function estimateCostMicroUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number {
  const price = priceFor(model);
  const input = ((inputTokens ?? 0) / 1_000_000) * price.input;
  const output = ((outputTokens ?? 0) / 1_000_000) * price.output;
  return Math.round((input + output) * 1_000_000);
}

export function formatMicroUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function sumUsage(records: LlmUsageRecord[]): LlmUsageRecord {
  return records.reduce<LlmUsageRecord>(
    (total, record) => ({
      model: "全部模型",
      calls: total.calls + record.calls,
      inputTokens: total.inputTokens + record.inputTokens,
      outputTokens: total.outputTokens + record.outputTokens,
      costMicroUsd: total.costMicroUsd + record.costMicroUsd,
    }),
    { model: "全部模型", calls: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 },
  );
}

export type ChatUsageEvent = { model: string; inputTokens?: number; outputTokens?: number };

/**
 * 包一层 ChatProvider，把每次调用的 token 用量记下来。
 *
 * 放在这一层而不是各业务函数里，是因为出题、判定基线、材料问答都走同一个 ChatProvider：
 * 包一次就全覆盖，不需要在每个调用点重复写计量代码（漏一个就等于账目不准）。
 */
export class RecordingChatProvider implements ChatProvider {
  readonly id: string;
  readonly origin: "byok" | "platform";
  get model(): string {
    return this.inner.model;
  }

  private readonly inner: ChatProvider;
  private readonly onUsage: (event: ChatUsageEvent) => void;

  constructor(inner: ChatProvider, onUsage: (event: ChatUsageEvent) => void) {
    this.inner = inner;
    this.onUsage = onUsage;
    this.id = inner.id;
    this.origin = inner.origin;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.inner.complete(request);
    this.onUsage({
      model: response.model,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
    });
    return response;
  }
}

/** 收集本次请求内的用量，交给服务层在操作结束后一次性落库。 */
export function usageCollector(): {
  onChatUsage: (event: ChatUsageEvent) => void;
  pending: ChatUsageEvent[];
} {
  const pending: ChatUsageEvent[] = [];
  return { onChatUsage: (event) => pending.push(event), pending };
}
