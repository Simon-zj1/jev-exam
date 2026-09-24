/**
 * 服务商目录（纯数据，可在浏览器端引用）。
 *
 * 用户只需要做两件事：选服务商、粘 Key。地址、默认模型、兼容层由平台适配。
 * 除 Anthropic 外，下面每一家都提供 OpenAI 兼容的 /chat/completions 接口。
 *
 * 模型名更新很快，这里的默认值只是建议，设置页允许直接改写。
 */

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "zhipu"
  | "qwen"
  | "moonshot"
  | "minimax"
  | "siliconflow"
  | "openrouter"
  | "groq"
  | "xai"
  | "vercel-gateway"
  | "ollama"
  | "custom";

export type ProviderProfile = {
  kind: ProviderKind;
  /** 中文名，设置页直接展示给不懂技术的用户 */
  label: string;
  baseUrl: string;
  defaultModel: string;
  /** 常见模型建议（可自由填写） */
  models: string[];
  /** 申请 Key 的入口 */
  keysUrl: string;
  /** 用 Key 形状做自动识别；同一前缀可能对应多家服务商，因此显式选择优先 */
  keyPrefixes?: string[];
  /** 本地/内网服务，通常不需要 Key */
  local?: boolean;
};

export const PROVIDER_CATALOG: Record<ProviderKind, ProviderProfile> = {
  deepseek: {
    kind: "deepseek",
    label: "DeepSeek（深度求索）",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keysUrl: "https://platform.deepseek.com/api_keys",
    keyPrefixes: ["sk-"],
  },
  zhipu: {
    kind: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.6",
    models: ["glm-4.6", "glm-4.5-air"],
    keysUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  qwen: {
    kind: "qwen",
    label: "通义千问（阿里云百炼）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    keysUrl: "https://bailian.console.aliyun.com/",
    keyPrefixes: ["sk-"],
  },
  moonshot: {
    kind: "moonshot",
    label: "Kimi（月之暗面）",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2-turbo-preview",
    models: ["kimi-k2-turbo-preview", "moonshot-v1-32k"],
    keysUrl: "https://platform.moonshot.cn/console/api-keys",
    keyPrefixes: ["sk-"],
  },
  minimax: {
    kind: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    models: ["MiniMax-Text-01", "abab6.5s-chat"],
    keysUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  },
  siliconflow: {
    kind: "siliconflow",
    label: "硅基流动（多模型聚合）",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-32B"],
    keysUrl: "https://cloud.siliconflow.cn/account/ak",
    keyPrefixes: ["sk-"],
  },
  openai: {
    kind: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
    models: ["gpt-5-mini", "gpt-5", "gpt-5-nano"],
    keysUrl: "https://platform.openai.com/api-keys",
    keyPrefixes: ["sk-proj-", "sk-"],
  },
  anthropic: {
    kind: "anthropic",
    label: "Anthropic（Claude）",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    models: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"],
    keysUrl: "https://console.anthropic.com/settings/keys",
    keyPrefixes: ["sk-ant-"],
  },
  google: {
    kind: "google",
    label: "Google（Gemini）",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    keysUrl: "https://aistudio.google.com/apikey",
    keyPrefixes: ["AIza"],
  },
  openrouter: {
    kind: "openrouter",
    label: "OpenRouter（多模型聚合）",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5-nano",
    models: ["openai/gpt-5-nano", "anthropic/claude-haiku-4-5", "deepseek/deepseek-chat"],
    keysUrl: "https://openrouter.ai/keys",
    keyPrefixes: ["sk-or-"],
  },
  groq: {
    kind: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile"],
    keysUrl: "https://console.groq.com/keys",
    keyPrefixes: ["gsk_"],
  },
  xai: {
    kind: "xai",
    label: "xAI（Grok）",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4-fast-non-reasoning",
    models: ["grok-4-fast-non-reasoning"],
    keysUrl: "https://console.x.ai/",
    keyPrefixes: ["xai-"],
  },
  "vercel-gateway": {
    kind: "vercel-gateway",
    label: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    defaultModel: "openai/gpt-5-nano",
    models: ["openai/gpt-5-nano"],
    keysUrl: "https://vercel.com/docs/ai-gateway",
    keyPrefixes: ["vck_"],
  },
  ollama: {
    kind: "ollama",
    label: "本地模型（Ollama / vLLM / LM Studio）",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen3:8b",
    models: ["qwen3:8b", "llama3.2", "glm4"],
    keysUrl: "https://ollama.com/download",
    local: true,
  },
  custom: {
    kind: "custom",
    label: "自定义（任何 OpenAI 兼容服务）",
    baseUrl: "",
    defaultModel: "",
    models: [],
    keysUrl: "",
  },
};

/** 设置页展示顺序：国内可直连的排前面 */
export const PROVIDER_ORDER: ProviderKind[] = [
  "deepseek",
  "zhipu",
  "qwen",
  "moonshot",
  "minimax",
  "siliconflow",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "groq",
  "xai",
  "vercel-gateway",
  "ollama",
  "custom",
];

export function providerOptions(): ProviderProfile[] {
  return PROVIDER_ORDER.map((kind) => PROVIDER_CATALOG[kind]);
}

export type ProviderDetection = {
  profile: ProviderProfile;
  /**
   * explicit  = 用户/配置里指明了服务商（最可靠）
   * precise   = Key 形状只对应一家（如 sk-ant- 只可能是 Anthropic）
   * ambiguous = Key 形状对应多家（DeepSeek / 通义 / Kimi / 硅基流动 / OpenAI 都是 sk- 开头）
   * default   = 认不出来，按通用 OpenAI 兼容处理
   */
  confidence: "explicit" | "precise" | "ambiguous" | "default";
};

export function detectProviderDetailed(apiKey: string, explicit?: string): ProviderDetection {
  const named = explicit?.trim().toLowerCase();
  if (named && named in PROVIDER_CATALOG) {
    return { profile: PROVIDER_CATALOG[named as ProviderKind], confidence: "explicit" };
  }

  // 智谱的 Key 是 id.secret 形式，用它做一次高置信度识别
  if (/^[0-9a-f]{8,}\.[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
    return { profile: PROVIDER_CATALOG.zhipu, confidence: "precise" };
  }

  // 最长前缀优先：sk-ant- 不会被当成 sk-
  const matches = PROVIDER_ORDER.flatMap((kind) =>
    (PROVIDER_CATALOG[kind].keyPrefixes ?? []).map((prefix) => ({
      profile: PROVIDER_CATALOG[kind],
      prefix,
    })),
  )
    .filter((entry) => apiKey.startsWith(entry.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  if (matches.length === 0) {
    return { profile: PROVIDER_CATALOG.custom, confidence: "default" };
  }

  const best = matches[0];
  const samePrefix = matches.filter((entry) => entry.prefix === best.prefix);
  if (samePrefix.length > 1) {
    // sk- 这类通用前缀对应多家服务商：不猜，按最常见的 OpenAI 给出建议，
    // 同时标记为 ambiguous，让设置页提示用户显式选择服务商。
    return { profile: PROVIDER_CATALOG.openai, confidence: "ambiguous" };
  }
  return { profile: best.profile, confidence: "precise" };
}

export function detectProvider(apiKey: string, explicit?: string): ProviderProfile {
  return detectProviderDetailed(apiKey, explicit).profile;
}
