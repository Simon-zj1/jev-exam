import { env } from "@/lib/env";

import {
  detectProvider,
  detectProviderDetailed,
  type ProviderKind,
  type ProviderProfile,
} from "@/lib/llm/catalog";

export {
  PROVIDER_CATALOG,
  PROVIDER_ORDER,
  providerOptions,
  detectProvider,
  detectProviderDetailed,
  type ProviderKind,
  type ProviderProfile,
} from "@/lib/llm/catalog";

export type ChatRequest = {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ChatResponse = {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  readonly origin: "byok" | "platform";
  complete(request: ChatRequest): Promise<ChatResponse>;
}

export type OpenAICompatibleOptions = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  origin?: "byok" | "platform";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** 瞬时故障的重试次数（不含首次）。出题一次可能跑几十秒，重试封顶在 2 次。 */
export const MAX_TRANSIENT_RETRIES = 2;

/** 带抖动的指数退避：多实例同时重试时避免打成新的尖峰。 */
function sleepWithBackoff(attempt: number): Promise<void> {
  const base = 400 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

/**
 * 判断是否值得重试。
 * - 网络层错误（fetch 抛出的 TypeError）与 AbortError（本地超时）值得重试；
 * - 429 / 5xx 值得重试；其它 4xx 是请求本身的问题，重试无用。
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  if (error.name === "TypeError") return true;
  const match = /LLM 返回 (\d{3})/.exec(error.message);
  if (!match) return false;
  const status = Number(match[1]);
  return status === 429 || status >= 500;
}

/**
 * 通用 OpenAI 兼容 Chat Completions 客户端（OpenAI / DeepSeek / 兼容网关均可）。
 * 注意：出题与大纲生成必须由这类生成式模型完成，Jev 不生成任何文本。
 */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  readonly origin: "byok" | "platform";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleOptions) {
    if (!options.apiKey) throw new Error("OpenAICompatibleProvider 需要 apiKey");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.origin = options.origin ?? "platform";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      try {
        return await this.completeOnce(request);
      } catch (error) {
        lastError = error;
        // 只重试瞬时故障：网络中断、超时、429、5xx。
        // 401/403/400 这类重试没有意义，只会浪费时间和配额。
        if (attempt >= MAX_TRANSIENT_RETRIES || !isTransient(error)) break;
        if (request.signal?.aborted) break;
        await sleepWithBackoff(attempt);
      }
    }
    throw lastError;
  }

  private async completeOnce(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`LLM 返回 ${response.status}：${text.slice(0, 300)}`);
      }

      const payload = JSON.parse(text) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("LLM 返回内容为空");
      }

      return {
        text: content,
        model: payload.model ?? this.model,
        usage: payload.usage
          ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export type GenerationConfig = {
  provider: ChatProvider;
  /** 配置来源，用于界面提示与排错 */
  source: "PLATFORM_LLM_API_KEY" | "AI_API_KEY" | "none";
  kind: ProviderKind;
  /** 服务商在界面上的中文名 */
  label: string;
  model: string;
  baseUrl: string;
  /** 是否由 key 形状推断得到 */
  detected: boolean;
  /** key 形状对应多家服务商（sk- 开头），需要用户确认 */
  ambiguous: boolean;
};

/**
 * 平台出题模型。两种配置方式：
 * 1. 显式：PLATFORM_LLM_API_KEY + 可选 PLATFORM_LLM_BASE_URL / PLATFORM_LLM_MODEL；
 * 2. 单 key：AI_API_KEY（+ 可选 AI_PROVIDER / AI_BASE_URL / CHAT_MODEL），provider 从 key 推断。
 * 都没有时返回 null，由调用方回落到离线确定性出题器。
 */
export function resolveGenerationConfig(): GenerationConfig | null {
  const explicitKey = env("PLATFORM_LLM_API_KEY");
  if (explicitKey) {
    const kind = (env("PLATFORM_LLM_PROVIDER") as ProviderKind | undefined) ?? "openai";
    const detection = detectProviderDetailed(explicitKey, kind);
    const profile = detection.profile;
    const baseUrl = (env("PLATFORM_LLM_BASE_URL") ?? profile.baseUrl).replace(/\/+$/, "");
    const model = env("PLATFORM_LLM_MODEL") ?? env("CHAT_MODEL") ?? profile.defaultModel;
    return {
      provider: new OpenAICompatibleProvider({ apiKey: explicitKey, baseUrl, model, origin: "platform" }),
      source: "PLATFORM_LLM_API_KEY",
      kind,
      label: profile.label,
      model,
      baseUrl,
      detected: false,
      ambiguous: false,
    };
  }

  const singleKey = env("AI_API_KEY");
  if (singleKey) {
    const named = env("AI_PROVIDER");
    const detection = detectProviderDetailed(singleKey, named);
    const profile = detection.profile;
    const baseUrl = (env("AI_BASE_URL") ?? profile.baseUrl).replace(/\/+$/, "");
    const model = env("CHAT_MODEL") ?? profile.defaultModel;
    return {
      provider: new OpenAICompatibleProvider({ apiKey: singleKey, baseUrl, model, origin: "platform" }),
      source: "AI_API_KEY",
      kind: profile.kind,
      label: profile.label,
      model,
      baseUrl,
      detected: detection.confidence !== "explicit",
      ambiguous: detection.confidence === "ambiguous",
    };
  }

  return null;
}

export function resolvePlatformChatProvider(): ChatProvider | null {
  return resolveGenerationConfig()?.provider ?? null;
}

export type ChatSelection = {
  provider: ChatProvider | null;
  mode: "byok" | "platform" | "offline";
  /** 是否计入平台额度：byok 与离线都不计 */
  countsAgainstQuota: boolean;
};

export type ChatCredential = {
  apiKey: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
};

let chatOverride: ChatSelection | null = null;

/**
 * 测试/评测专用：强制所有对话调用走同一个 provider。
 * 允许声明「算不算平台额度」，这样额度闸门也能被真实覆盖到（而不是只在生产路径上生效）。
 */
export function setChatProviderOverride(
  provider: ChatProvider | null,
  options: { countsAgainstQuota?: boolean; mode?: ChatSelection["mode"] } = {},
): void {
  chatOverride = provider
    ? {
        provider,
        mode: options.mode ?? "platform",
        countsAgainstQuota: options.countsAgainstQuota ?? false,
      }
    : null;
}

/**
 * 对话模型选择顺序：用户自带 LLM key → 平台 LLM key → 无（由调用方决定降级方式）。
 * 材料问答与出题共用同一条选择链，避免「出题能跑、问答没模型」这种半残状态。
 */
export function resolveChatProvider(credential?: ChatCredential | null): ChatSelection {
  if (chatOverride) return chatOverride;

  if (credential?.apiKey) {
    const profile = detectProvider(credential.apiKey, credential.provider);
    return {
      provider: new OpenAICompatibleProvider({
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl ?? profile.baseUrl ?? undefined,
        model: credential.model ?? profile.defaultModel ?? "gpt-4o-mini",
        origin: "byok",
      }),
      mode: "byok",
      countsAgainstQuota: false,
    };
  }

  const platform = resolvePlatformChatProvider();
  if (platform) return { provider: platform, mode: "platform", countsAgainstQuota: true };
  return { provider: null, mode: "offline", countsAgainstQuota: false };
}
