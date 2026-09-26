import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { INGEST_MAX_PAGES, MAX_MATERIAL_CHARS } from "@/lib/config";
import { titleFromFileName } from "@/lib/ingest/file-kind";
import type { IngestPage, IngestResult } from "@/lib/ingest/types";

/** pdfjs 的文本项：只需要位置与文本，其余字段忽略。 */
type PdfTextItem = {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
};

type PdfJsModule = {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<PdfDocument> };
};

type PdfDocument = {
  numPages: number;
  getPage: (page: number) => Promise<PdfPage>;
};

type PdfPage = {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
};

let cachedModule: PdfJsModule | null = null;
let cachedStandardFontsUrl: string | null = null;

/**
 * 标准字体（Helvetica 之类）不在 PDF 里内嵌，pdfjs 需要外部目录来补字形。
 * 不指定会打出 "Ensure that the standardFontDataUrl API parameter is provided"，
 * 并且部分符号会退化成乱码，所以指向包内自带的 standard_fonts。
 */
function standardFontDataUrl(): string | null {
  if (cachedStandardFontsUrl !== null) return cachedStandardFontsUrl;
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("pdfjs-dist/package.json");
    cachedStandardFontsUrl = `${join(dirname(entry), "standard_fonts")}/`;
  } catch {
    cachedStandardFontsUrl = "";
  }
  return cachedStandardFontsUrl || null;
}

/**
 * 用 legacy 构建：它带 Node 可用的 polyfill，不依赖浏览器 worker。
 * 动态 import 是为了让不处理 PDF 的路径不必加载这个体积较大的包。
 */
async function loadPdfjs(): Promise<PdfJsModule> {
  if (cachedModule) return cachedModule;
  const module = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
  cachedModule = module;
  return module;
}

/**
 * 把一页的文本项还原成行。
 *
 * pdfjs 给的是按内容流顺序排列的片段，直接拼会把整页粘成一行；
 * 这里用基线的 y 坐标判断换行，再按是否需要空格拼接。
 */
function itemsToLines(items: PdfTextItem[]): string[] {
  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) lines.push(trimmed);
    current = "";
  };

  for (const item of items) {
    const text = (item.str ?? "").replace(/\u0000/g, "");
    if (!text) {
      if (item.hasEOL) flush();
      continue;
    }
    const y = item.transform?.[5];
    if (typeof y === "number" && lastY !== null && Math.abs(y - lastY) > 1.5) flush();
    if (current && needsSpace(current, text)) current += " ";
    current += text;
    if (item.hasEOL) flush();
    if (typeof y === "number") lastY = y;
  }
  flush();
  return lines;
}

/** 只有两侧都是拉丁字母/数字时才补空格，中文与标点之间不补。 */
function needsSpace(previous: string, next: string): boolean {
  const last = previous.slice(-1);
  const first = next.slice(0, 1);
  return /[A-Za-z0-9]/.test(last) && /[A-Za-z0-9]/.test(first);
}

export async function extractPdfText(buffer: Uint8Array, fileName: string): Promise<IngestResult> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    // 用副本：pdfjs 会接管并释放传入的 buffer
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    ...(standardFontDataUrl() ? { standardFontDataUrl: standardFontDataUrl() } : {}),
  });
  const document = await loadingTask.promise;

  const warnings: string[] = [];
  const pages: IngestPage[] = [];
  const chunks: string[] = [];
  let emptyPageCount = 0;
  let charCount = 0;
  let truncatedAt: number | null = null;

  const limit = Math.min(document.numPages, INGEST_MAX_PAGES);
  if (document.numPages > limit) {
    warnings.push(`文档共 ${document.numPages} 页，只解析前 ${limit} 页；更大的文档建议先拆分。`);
  }

  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = itemsToLines(content.items).join("\n").trim();

    if (!pageText) {
      emptyPageCount += 1;
      pages.push({ page: pageNumber, charStart: charCount, charEnd: charCount, charCount: 0 });
      continue;
    }

    if (charCount > 0) {
      // 页之间留空行，避免上一页末句与下一页首句被当作同一句
      chunks.push("\n\n");
      charCount += 2;
    }

    const remaining = MAX_MATERIAL_CHARS - charCount;
    if (remaining <= 0) {
      truncatedAt = pageNumber;
      break;
    }

    const piece = pageText.length > remaining ? pageText.slice(0, remaining) : pageText;
    chunks.push(piece);
    pages.push({
      page: pageNumber,
      charStart: charCount,
      charEnd: charCount + piece.length,
      charCount: piece.length,
    });
    charCount += piece.length;
    if (piece.length < pageText.length) {
      truncatedAt = pageNumber;
      break;
    }
  }

  if (emptyPageCount > 0) {
    warnings.push(
      `${emptyPageCount} 页没有提取到文字，通常是扫描件或纯图片页；这部分内容不会进入材料，如需使用请先做 OCR。`,
    );
  }
  if (truncatedAt !== null) {
    warnings.push(`正文过长，已在第 ${truncatedAt} 页处截断到 ${MAX_MATERIAL_CHARS} 字符。`);
  }

  return {
    kind: "pdf",
    title: titleFromFileName(fileName),
    text: chunks.join("").trim(),
    pageCount: document.numPages,
    pages,
    warnings,
    stats: { charCount, emptyPageCount },
  };
}
