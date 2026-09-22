import { z } from "zod";

const credentialSchema = z.object({
  apiKey: z.string().min(8),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
});

/**
 * 用户自带密钥：
 * - judge 走 TypeSafe（Jev）判定
 * - llm 走出题/大纲生成（OpenAI 兼容接口）
 */
export const byokSchema = z.object({
  judge: credentialSchema.optional(),
  llm: credentialSchema.optional(),
});

export type ByokConfig = z.infer<typeof byokSchema>;
export type ByokCredential = z.infer<typeof credentialSchema>;

export function parseByok(value: unknown): ByokConfig | null {
  const parsed = byokSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function byokSummary(config: ByokConfig | null) {
  return {
    judgeConfigured: Boolean(config?.judge?.apiKey),
    llmConfigured: Boolean(config?.llm?.apiKey),
    judgeModel: config?.judge?.model ?? null,
    llmModel: config?.llm?.model ?? null,
    llmBaseUrl: config?.llm?.baseUrl ?? null,
    judgeBaseUrl: config?.judge?.baseUrl ?? null,
  };
}
