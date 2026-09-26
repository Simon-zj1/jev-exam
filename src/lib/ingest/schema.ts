import { z } from "zod";
import type { SourceMap } from "@/lib/ingest/types";

const ingestPageSchema = z.object({
  page: z.number().int().positive(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
});

const healthCheckSchema = z.object({
  id: z.string().max(60),
  label: z.string().max(60),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string().max(400),
});

const healthSchema = z.object({
  level: z.enum(["good", "fair", "poor"]),
  summary: z.string().max(200),
  checks: z.array(healthCheckSchema).max(20),
});

/**
 * 页面映射来自客户端回传，必须当成不可信输入校验：
 * 一个越界的 charStart 会让「第 N 页」指到错误的位置，而且不会报错。
 */
export const sourceMapSchema = z.object({
  kind: z.enum(["pdf", "docx", "text"]),
  fileName: z.string().min(1).max(300),
  pageCount: z.number().int().positive().nullable(),
  pages: z.array(ingestPageSchema).max(2000).nullable(),
  warnings: z.array(z.string().max(400)).max(20),
  // 旧数据的 sourceMap 没有体检结论，允许缺失
  health: healthSchema.optional(),
});

export function parseSourceMap(value: unknown): SourceMap | null {
  if (value === null || value === undefined) return null;
  const parsed = sourceMapSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
