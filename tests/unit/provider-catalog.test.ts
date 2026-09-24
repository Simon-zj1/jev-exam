import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  detectProvider,
  detectProviderDetailed,
  providerOptions,
} from "@/lib/llm/catalog";
import { resolveGenerationConfig } from "@/lib/llm/provider";

describe("服务商目录", () => {
  it("每家服务商都有可用的默认配置", () => {
    for (const [kind, profile] of Object.entries(PROVIDER_CATALOG)) {
      expect(profile.kind).toBe(kind);
      expect(profile.label.length).toBeGreaterThan(0);
      if (kind === "custom") continue;
      expect(profile.baseUrl, `${kind} 缺少接口地址`).toMatch(/^https?:\/\//);
      expect(profile.defaultModel.length, `${kind} 缺少默认模型`).toBeGreaterThan(0);
      expect(profile.keysUrl, `${kind} 缺少申请入口`).toMatch(/^https:\/\//);
    }
  });

  it("国内可直连的服务商排在设置页前面", () => {
    const order = providerOptions().map((profile) => profile.kind);
    expect(order.slice(0, 6)).toEqual([
      "deepseek",
      "zhipu",
      "qwen",
      "moonshot",
      "minimax",
      "siliconflow",
    ]);
  });
});

describe("服务商识别", () => {
  it("显式选择优先于 Key 形状", () => {
    const detection = detectProviderDetailed("sk-abcdefghijklmnop", "deepseek");
    expect(detection.profile.kind).toBe("deepseek");
    expect(detection.confidence).toBe("explicit");
  });

  it("只对应一家的前缀可以精确识别", () => {
    expect(detectProviderDetailed("sk-ant-api03-xxxxxxxx").profile.kind).toBe("anthropic");
    expect(detectProviderDetailed("AIzaSyA-xxxxxxxx").profile.kind).toBe("google");
    expect(detectProviderDetailed("gsk_xxxxxxxx").profile.kind).toBe("groq");
    expect(detectProviderDetailed("xai-xxxxxxxx").profile.kind).toBe("xai");
    expect(detectProviderDetailed("vck_xxxxxxxx").profile.kind).toBe("vercel-gateway");
    expect(detectProviderDetailed("sk-or-v1-xxxxxxxx").profile.kind).toBe("openrouter");
  });

  it("智谱的 id.secret 形式可以被识别", () => {
    const detection = detectProviderDetailed("1a2b3c4d5e6f7890.abcdefghijklmnop");
    expect(detection.profile.kind).toBe("zhipu");
    expect(detection.confidence).toBe("precise");
  });

  it("sk- 开头对应多家时不猜，标记为 ambiguous", () => {
    const detection = detectProviderDetailed("sk-1234567890abcdef");
    expect(detection.confidence).toBe("ambiguous");
    // 给出 OpenAI 作为最常见建议，但上层会提示用户显式选择
    expect(detection.profile.kind).toBe("openai");
  });

  it("认不出来的 Key 落到自定义服务商", () => {
    const detection = detectProviderDetailed("something-weird-123");
    expect(detection.confidence).toBe("default");
    expect(detection.profile.kind).toBe("custom");
  });
});

describe("环境变量配置", () => {
  const originalKey = process.env.AI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;
  const originalBase = process.env.AI_BASE_URL;

  beforeEach(() => {
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_BASE_URL;
    delete process.env.PLATFORM_LLM_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalKey;
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalBase === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBase;
  });

  it("AI_API_KEY + AI_PROVIDER 时用该服务商的地址与默认模型", () => {
    process.env.AI_API_KEY = "sk-1234567890abcdef";
    process.env.AI_PROVIDER = "deepseek";
    const config = resolveGenerationConfig();
    expect(config?.kind).toBe("deepseek");
    expect(config?.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(config?.model).toBe("deepseek-chat");
    expect(config?.ambiguous).toBe(false);
  });

  it("只给 AI_API_KEY 且前缀有歧义时，标记 ambiguous 让界面提示用户", () => {
    process.env.AI_API_KEY = "sk-1234567890abcdef";
    const config = resolveGenerationConfig();
    expect(config?.ambiguous).toBe(true);
    expect(config?.detected).toBe(true);
  });

  it("没有配置任何 Key 时返回 null", () => {
    expect(resolveGenerationConfig()).toBeNull();
  });
});
