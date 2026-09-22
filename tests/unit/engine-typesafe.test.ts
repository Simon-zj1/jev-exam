import { describe, expect, it } from "vitest";
import { TypeSafeEngine } from "@/lib/engine/typesafe";
import { DecisionEngineError } from "@/lib/types";

type FetchCall = { url: string; init: RequestInit };

function mockFetch(response: Response): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const questions = {
  covers_point: { type: "noul" as const, instructions: "是否覆盖该得分点" },
};

describe("TypeSafe（Jev）引擎", () => {
  it("按 System One 契约发送请求并解析答案", async () => {
    const { fetchImpl, calls } = mockFetch(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { covers_point: { type: "noul", noul: 0.87 } },
          usage: { input_tokens: 392, output_tokens: 0 },
        }),
        { status: 200 },
      ),
    );

    const engine = new TypeSafeEngine({ apiKey: "test-key", fetchImpl });
    const result = await engine.decide({ answer: { text: "光反应" } }, questions);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("jev-latest");
    expect(body.questions).toEqual(questions);
    expect(body.state).toEqual({ answer: { text: "光反应" } });

    expect(result.model).toBe("jev-1.13.0");
    expect(result.answers.covers_point).toEqual({ type: "noul", noul: 0.87 });
    expect(result.usage).toEqual({ inputTokens: 392, outputTokens: 0 });
  });

  it("概率会被裁剪到 0..1", async () => {
    const { fetchImpl } = mockFetch(
      new Response(
        JSON.stringify({ answers: { covers_point: { type: "noul", noul: 1.4 } } }),
        { status: 200 },
      ),
    );
    const engine = new TypeSafeEngine({ apiKey: "k", fetchImpl });
    const result = await engine.decide("s", questions);
    expect(result.answers.covers_point).toEqual({ type: "noul", noul: 1 });
  });

  it("429/5xx 标记为可重试错误，并带上状态码", async () => {
    const { fetchImpl } = mockFetch(new Response("rate limited", { status: 429 }));
    const engine = new TypeSafeEngine({ apiKey: "k", fetchImpl });
    await expect(engine.decide("s", questions)).rejects.toMatchObject({
      engineId: "typesafe",
      status: 429,
      retryable: true,
    });
  });

  it("缺少答案时抛出可重试错误", async () => {
    const { fetchImpl } = mockFetch(
      new Response(JSON.stringify({ answers: {} }), { status: 200 }),
    );
    const engine = new TypeSafeEngine({ apiKey: "k", fetchImpl });
    const error = await engine.decide("s", questions).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DecisionEngineError);
    expect((error as DecisionEngineError).message).toContain("covers_point");
  });

  it("非 JSON 响应被识别为可重试错误", async () => {
    const { fetchImpl } = mockFetch(new Response("<html>oops</html>", { status: 200 }));
    const engine = new TypeSafeEngine({ apiKey: "k", fetchImpl });
    await expect(engine.decide("s", questions)).rejects.toThrow(/不是合法 JSON/);
  });

  it("自定义 baseUrl 与 model 生效", async () => {
    const { fetchImpl, calls } = mockFetch(
      new Response(JSON.stringify({ answers: { covers_point: { type: "noul", noul: 0.5 } } }), {
        status: 200,
      }),
    );
    const engine = new TypeSafeEngine({
      apiKey: "k",
      baseUrl: "https://example.test/",
      model: "jev-1.13.0",
      fetchImpl,
    });
    await engine.decide("s", questions);
    expect(calls[0].url).toBe("https://example.test/v1/systemone");
    expect(JSON.parse(String(calls[0].init.body)).model).toBe("jev-1.13.0");
  });
});
