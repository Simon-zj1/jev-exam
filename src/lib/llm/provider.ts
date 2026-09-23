import { env } from "@/lib/env";

/**
 * 一个 key 就能跑起来：不写 base_url 时，从 key 的形状推断 provider。
 * 这条路是为了把首次运行的门槛压到「粘一个 key」，而不是让用户先研究四个变量。
 */
export type ProviderKind =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "groq"
  | "xai"
  | "vercel-gateway"
  | "custom";

type ProviderProfile = {
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  /** 是否走 OpenAI 兼容层（除 Anthropic 外都是原生兼容） */
  compatibleLayer?: boolean;
};

const PROFILES: Record<ProviderKind, ProviderProfile> = {
  openai: { kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5-mini" },
  anthropic: {
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    compatibleLayer: true,
  },
  google: {
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
  },
  openrouter: {
    kind: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5-nano",
  },
  groq: {
    kind: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  xai: { kind: "xai", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4-fast-non-reasoning" },
  "vercel-gateway": {
    kind: "vercel-gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    defaultModel: "openai/gpt-5-nano",
  },
  custom: { kind: "custom", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.2" },
};

const KEY_PREFIXES: { prefix: string; kind: ProviderKind }[] = [
  { prefix: "sk-ant-", kind: "anthropic" },
  { prefix: "sk-or-", kind: "openrouter" },
  { prefix: "sk-proj-", kind: "openai" },
  { prefix: "sk-", kind: "openai" },
  { prefix: "AIza", kind: "google" },
  { prefix: "gsk_", kind: "groq" },
  { prefix: "xai-", kind: "xai" },
  { prefix: "vck_", kind: "vercel-gateway" },
];

export function detectProvider(apiKey: string, explicit?: string): ProviderProfile {
  const named = explicit?.trim().toLowerCase();
  if (named && named in PROFILES) return PROFILES[named as ProviderKind];
  const match = KEY_PREFIXES.find((entry) => apiKey.startsWith(entry.prefix));
  return match ? PROFILES[match.kind] : PROFILES.custom;
}

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
  model: string;
  baseUrl: string;
  /** 是否由 key 形状推断得到 */
  detected: boolean;
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
    const profile = detectProvider(explicitKey, kind);
    const baseUrl = (env("PLATFORM_LLM_BASE_URL") ?? profile.baseUrl).replace(/\/+$/, "");
    const model = env("PLATFORM_LLM_MODEL") ?? env("CHAT_MODEL") ?? profile.defaultModel;
    return {
      provider: new OpenAICompatibleProvider({ apiKey: explicitKey, baseUrl, model, origin: "platform" }),
      source: "PLATFORM_LLM_API_KEY",
      kind,
      model,
      baseUrl,
      detected: false,
    };
  }

  const singleKey = env("AI_API_KEY");
  if (singleKey) {
    const named = env("AI_PROVIDER");
    const profile = detectProvider(singleKey, named);
    const baseUrl = (env("AI_BASE_URL") ?? profile.baseUrl).replace(/\/+$/, "");
    const model = env("CHAT_MODEL") ?? profile.defaultModel;
    return {
      provider: new OpenAICompatibleProvider({ apiKey: singleKey, baseUrl, model, origin: "platform" }),
      source: "AI_API_KEY",
      kind: profile.kind,
      model,
      baseUrl,
      detected: named === undefined,
    };
  }

  return null;
}

export function resolvePlatformChatProvider(): ChatProvider | null {
  return resolveGenerationConfig()?.provider ?? null;
}
