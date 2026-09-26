import { MAX_MATERIAL_CHARS } from "@/lib/config";
import { titleFromFileName } from "@/lib/ingest/file-kind";
import type { IngestResult } from "@/lib/ingest/types";

type MammothModule = {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string; messages: unknown[] }>;
};

let cachedModule: MammothModule | null = null;

async function loadMammoth(): Promise<MammothModule> {
  if (cachedModule) return cachedModule;
  // mammoth 是 CJS，动态 import 会落到 default 上
  const imported = (await import("mammoth")) as unknown as MammothModule & {
    default?: MammothModule;
  };
  const module = typeof imported.extractRawText === "function" ? imported : imported.default;
  if (!module) throw new Error("mammoth 模块加载失败");
  cachedModule = module;
  return module;
}

/** 解析 .docx：只取纯文本，不保留样式（本项目的材料一律是纯文本）。 */
export async function extractDocxText(buffer: Uint8Array, fileName: string): Promise<IngestResult> {
  const mammoth = await loadMammoth();
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });

  const normalized = value
    .replace(/\r\n?/g, "\n")
    // Word 的空段落会连出多个空行，压掉避免材料里出现大片空白
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const warnings: string[] = [];
  const text = normalized.length > MAX_MATERIAL_CHARS ? normalized.slice(0, MAX_MATERIAL_CHARS) : normalized;
  if (text.length < normalized.length) {
    warnings.push(`正文过长，已截断到 ${MAX_MATERIAL_CHARS} 字符。`);
  }
  // .docx 没有固定页的概念，页码交给 Word 排版决定，这里如实说明
  warnings.push("Word 文档没有固定页码，出处只能定位到原文句子。");

  return {
    kind: "docx",
    title: titleFromFileName(fileName),
    text,
    pageCount: null,
    pages: null,
    warnings,
    stats: { charCount: text.length, emptyPageCount: 0 },
  };
}
