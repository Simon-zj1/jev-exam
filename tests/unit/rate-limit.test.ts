import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientKey, resetRateLimits } from "@/lib/rate-limit";
import { MAX_TRANSIENT_RETRIES, OpenAICompatibleProvider } from "@/lib/llm/provider";

afterEach(() => resetRateLimits());

describe("限流（滑动窗口）", () => {
  const rule = { limit: 3, windowMs: 1000 };

  it("窗口内超过阈值会被拒绝，并给出等待秒数", () => {
    const start = 1_000_000;
    expect(checkRateLimit("k", rule, start).allowed).toBe(true);
    expect(checkRateLimit("k", rule, start + 100).allowed).toBe(true);
    expect(checkRateLimit("k", rule, start + 200).allowed).toBe(true);

    const blocked = checkRateLimit("k", rule, start + 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it("窗口滑过之后恢复", () => {
    const start = 2_000_000;
    for (let index = 0; index < 3; index += 1) checkRateLimit("k2", rule, start + index);
    expect(checkRateLimit("k2", rule, start + 400).allowed).toBe(false);
    // 最早的一次已经滑出窗口
    expect(checkRateLimit("k2", rule, start + 1100).allowed).toBe(true);
  });

  it("不同 key 之间互不影响", () => {
    const start = 3_000_000;
    for (let index = 0; index < 3; index += 1) checkRateLimit("a", rule, start);
    expect(checkRateLimit("a", rule, start).allowed).toBe(false);
    expect(checkRateLimit("b", rule, start).allowed).toBe(true);
  });

  it("优先按 x-forwarded-for 取客户端标识", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientKey(request)).toBe("1.2.3.4");
  });
});

describe("模型调用的瞬时故障重试", () => {
  it("5xx 会重试，4xx 直接失败", async () => {
    const calls: number[] = [];
    const flaky = new OpenAICompatibleProvider({
      apiKey: "test-key-1234",
      model: "test-model",
      fetchImpl: (async () => {
        calls.push(1);
        if (calls.length === 1) {
          return new Response("upstream boom", { status: 503 });
        }
        return new Response(
          JSON.stringify({ model: "test-model", choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
      timeoutMs: 2000,
    });

    const response = await flaky.complete({ system: "s", user: "u" });
    expect(response.text).toBe("ok");
    expect(calls.length).toBe(2);

    const alwaysBad = new OpenAICompatibleProvider({
      apiKey: "test-key-1234",
      model: "test-model",
      fetchImpl: (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch,
      timeoutMs: 2000,
    });
    await expect(alwaysBad.complete({ system: "s", user: "u" })).rejects.toThrow("401");
    expect(MAX_TRANSIENT_RETRIES).toBeGreaterThan(0);
  }, 15_000);

  it("一直 5xx 时重试到上限后抛出", async () => {
    let count = 0;
    const alwaysDown = new OpenAICompatibleProvider({
      apiKey: "test-key-1234",
      model: "test-model",
      fetchImpl: (async () => {
        count += 1;
        return new Response("boom", { status: 502 });
      }) as unknown as typeof fetch,
      timeoutMs: 2000,
    });

    await expect(alwaysDown.complete({ system: "s", user: "u" })).rejects.toThrow("502");
    expect(count).toBe(MAX_TRANSIENT_RETRIES + 1);
  }, 15_000);
});
