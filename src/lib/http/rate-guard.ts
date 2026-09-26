import { NextResponse } from "next/server";
import { checkRateLimit, clientKey, type RateLimitRule } from "@/lib/rate-limit";

/**
 * 路由入口的限流包装：命中阈值时直接返回 429 与 Retry-After。
 * 放在这里而不是 service 层，是因为限流针对的是「谁在打这个接口」，属于 HTTP 层的事。
 */
export const RATE_RULES = {
  /** 登录：防邀请码爆破 */
  login: { limit: 10, windowMs: 60_000 },
  /** 上传解析：单次成本高（要跑 pdfjs） */
  extract: { limit: 10, windowMs: 60_000 },
  /** 出题与大纲：最贵的一类调用 */
  generate: { limit: 12, windowMs: 60_000 },
  /** 判定与问答：次数多但单次便宜 */
  judge: { limit: 90, windowMs: 60_000 },
  ask: { limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export function rateLimitResponse(
  request: Request,
  scope: keyof typeof RATE_RULES,
): NextResponse | null {
  const result = checkRateLimit(`${scope}:${clientKey(request)}`, RATE_RULES[scope]);
  if (result.allowed) return null;

  return NextResponse.json(
    {
      error: `请求过于频繁，请 ${result.retryAfterSeconds} 秒后重试。`,
      code: "rate_limited",
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
