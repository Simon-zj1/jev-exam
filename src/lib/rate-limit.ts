/**
 * 应用层限流（滑动窗口计数）。
 *
 * **这是兜底，不是主防线。** 计数存在进程内存里，Serverless 多实例时每个实例各算一份，
 * 所以真实阈值约等于「配置值 × 实例数」。它能挡住单个客户端打同一实例的突发，
 * 挡不住分布式刷接口——真正的防线仍然要在边缘/反向代理上做（见 SECURITY.md 部署清单）。
 *
 * 之所以还是要有：SECURITY.md 把「给 /api 加限流」写成了上线前置条件，
 * 而在此之前代码里一行都没有。有兜底 + 明确写清它的边界，好过一句承诺。
 */

export type RateLimitRule = {
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** 被拒绝时，建议客户端等待多久（秒） */
  retryAfterSeconds: number;
};

type Bucket = {
  /** 窗口内的命中时间戳（毫秒），按时间升序 */
  hits: number[];
};

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

/** 顺手清理过期 bucket，避免无人访问的 key 永久占内存 */
function sweep(now: number, maxWindowMs: number): void {
  for (const [key, bucket] of buckets) {
    const fresh = bucket.hits.filter((hit) => now - hit < maxWindowMs);
    if (fresh.length === 0) buckets.delete(key);
    else bucket.hits = fresh;
  }
}

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitResult {
  // 超过上限就整表清理一次，防止内存被随机 key 撑爆
  if (buckets.size > MAX_KEYS) sweep(now, rule.windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  const cutoff = now - rule.windowMs;
  const hits = bucket.hits.filter((hit) => hit > cutoff);

  if (hits.length >= rule.limit) {
    buckets.set(key, { hits });
    const oldest = hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, { hits });
  return { allowed: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0 };
}

/** 测试与本地重置用 */
export function resetRateLimits(): void {
  buckets.clear();
}

/** 从请求头取客户端标识；取不到就退回一个共享桶（宁可误伤，不可全放行）。 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
