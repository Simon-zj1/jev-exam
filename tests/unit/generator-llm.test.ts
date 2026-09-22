import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmGenerationProvider } from "@/lib/generator/llm";
import { OpenAICompatibleProvider } from "@/lib/llm/provider";
import { SAMPLE_MATERIAL } from "../helpers";

const topics = [
  {
    id: "t1",
    title: "光反应",
    summary: "光反应发生在类囊体薄膜上",
    source_spans: ["光反应发生在类囊体薄膜上，需要光照"],
  },
];

function chatResponse(content: unknown) {
  return new Response(
    JSON.stringify({
      model: "platform-model-1",
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 1200, completion_tokens: 400 },
    }),
    { status: 200 },
  );
}

describe("LLM 出题", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.PLATFORM_LLM_API_KEY = "test-platform-key";
    process.env.PLATFORM_LLM_MODEL = "platform-model-1";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.PLATFORM_LLM_API_KEY;
    delete process.env.PLATFORM_LLM_MODEL;
    vi.restoreAllMocks();
  });

  it("解析合法题目并通过落地校验", async () => {
    globalThis.fetch = vi.fn(async () =>
      chatResponse({
        questions: [
          {
            id: "q1",
            topic_id: "t1",
            type: "true_false",
            stem: "判断：光反应需要光照。",
            answer: true,
            difficulty: "easy",
            source_anchor: "光反应发生在类囊体薄膜上，需要光照",
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const provider = new LlmGenerationProvider(
      new OpenAICompatibleProvider({ apiKey: "k", model: "platform-model-1" }),
    );
    const result = await provider.generateQuestions({
      materialText: SAMPLE_MATERIAL,
      topics,
      mix: { true_false: 1 },
      count: 1,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].type).toBe("true_false");
    expect(result.model).toBe("platform-model-1");
  });

  it("锚点无法定位的题目被丢弃并触发重试", async () => {
    const responses = [
      chatResponse({
        questions: [
          {
            id: "bad",
            topic_id: "t1",
            type: "true_false",
            stem: "判断：光反应发生在线粒体。",
            answer: false,
            difficulty: "easy",
            source_anchor: "光反应发生在线粒体外膜上",
          },
        ],
      }),
      chatResponse({
        questions: [
          {
            id: "good",
            topic_id: "t1",
            type: "true_false",
            stem: "判断：光反应需要光照。",
            answer: true,
            difficulty: "easy",
            source_anchor: "光反应发生在类囊体薄膜上，需要光照",
          },
        ],
      }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? responses[0]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new LlmGenerationProvider(
      new OpenAICompatibleProvider({ apiKey: "k", model: "platform-model-1" }),
    );
    const result = await provider.generateQuestions({
      materialText: SAMPLE_MATERIAL,
      topics,
      mix: { true_false: 1 },
      count: 1,
    });

    expect(result.questions.map((question) => question.id)).toEqual(["good"]);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(result.raw)).toContain("anchor_missing");
  });

  it("平台 provider 被识别为占用额度的路径", async () => {
    const { resolveGenerationProvider } = await import("@/lib/generator");
    const selection = resolveGenerationProvider({});
    expect(selection.provider.id).toBe("llm-generator");
    expect(selection.mode).toBe("platform");
    expect(selection.countsAgainstQuota).toBe(true);
  });
});
