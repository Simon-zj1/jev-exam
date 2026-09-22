import { env } from "@/lib/env";

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

/** 平台级出题模型；未配置时返回 null，由调用方回落到离线确定性出题器。 */
export function resolvePlatformChatProvider(): ChatProvider | null {
  const apiKey = env("PLATFORM_LLM_API_KEY");
  if (!apiKey) return null;
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: env("PLATFORM_LLM_BASE_URL"),
    model: env("PLATFORM_LLM_MODEL") ?? "gpt-5-mini",
    origin: "platform",
  });
}
