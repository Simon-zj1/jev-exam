import { MAX_MATERIAL_CHARS, MAX_UPLOAD_BYTES } from "@/lib/config";
import { ValidationError } from "@/lib/errors";
import { extractDocxText } from "@/lib/ingest/docx";
import { detectFileKind, titleFromFileName } from "@/lib/ingest/file-kind";
import { diagnoseIngest } from "@/lib/ingest/health";
import { extractPdfText } from "@/lib/ingest/pdf";
import type { IngestResult, RawIngestResult, SourceMap } from "@/lib/ingest/types";
import { normalizeCjkCompatibility } from "@/lib/text";

export type { IngestKind, IngestPage, IngestResult, SourceMap } from "@/lib/ingest/types";
export type { HealthCheck, HealthStatus, IngestHealth } from "@/lib/ingest/health";
export { diagnoseIngest } from "@/lib/ingest/health";
export { pageAt } from "@/lib/ingest/types";
export { detectFileKind, titleFromFileName } from "@/lib/ingest/file-kind";

const UNSUPPORTED_HINT: Record<string, string> = {
  doc: "旧版 .doc 无法解析，请在 Word 里另存为 .docx 后重新上传。",
  unknown: "只支持 PDF、Word（.docx）与纯文本（.txt / .md）。",
};

/**
 * 把上传的文件解析成可直接保存的材料正文。
 *
 * 失败一律抛 ValidationError，交给 HTTP 层转成 400，并且错误文案面向用户
 * （「这份 PDF 是扫描件」比「InvalidPDFException」有用得多）。
 */
export async function extractMaterialFromFile(input: {
  buffer: Uint8Array;
  fileName: string;
}): Promise<{ result: IngestResult; sourceMap: SourceMap }> {
  const { buffer, fileName } = input;

  if (buffer.length === 0) throw new ValidationError("文件是空的");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `文件超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限，请压缩或拆分后重试。`,
    );
  }

  const detected = detectFileKind(buffer, fileName);
  if (!detected.supported) {
    throw new ValidationError(UNSUPPORTED_HINT[detected.kind] ?? UNSUPPORTED_HINT.unknown);
  }

  let extraction: RawIngestResult;
  try {
    if (detected.kind === "pdf") {
      extraction = await extractPdfText(buffer, fileName);
    } else if (detected.kind === "docx") {
      extraction = await extractDocxText(buffer, fileName);
    } else {
      const text = normalizeCjkCompatibility(
        Buffer.from(buffer).toString("utf8").replace(/\r\n?/g, "\n"),
      ).trim();
      extraction = {
        kind: "text",
        title: titleFromFileName(fileName),
        text: text.length > MAX_MATERIAL_CHARS ? text.slice(0, MAX_MATERIAL_CHARS) : text,
        pageCount: null,
        pages: null,
        warnings: [],
        stats: { charCount: text.length, emptyPageCount: 0 },
      };
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(describeExtractionFailure(detected.kind, error));
  }

  if (extraction.text.length < 80) {
    throw new ValidationError(
      detected.kind === "pdf"
        ? "这份 PDF 没有提取到足够文字，多半是扫描件或纯图片。请先用 OCR 转成文字，或直接粘贴正文。"
        : "解析出来的文字太少，无法作为学习材料。",
    );
  }

  // 体检结论在这里统一生成：解析器只管抽文字，判「能不能用」是同一套标准
  const health = diagnoseIngest({
    kind: extraction.kind,
    text: extraction.text,
    pageCount: extraction.pageCount,
    pages: extraction.pages,
    emptyPageCount: extraction.stats.emptyPageCount,
  });
  const result: IngestResult = { ...extraction, health };

  return {
    result,
    sourceMap: {
      kind: result.kind,
      fileName,
      pageCount: result.pageCount,
      pages: result.pages,
      warnings: result.warnings,
      health,
    },
  };
}

function describeExtractionFailure(kind: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (kind === "pdf") {
    if (/password/i.test(message)) return "这份 PDF 有密码保护，请先解除密码再上传。";
    return `PDF 解析失败：${message.slice(0, 160)}`;
  }
  if (kind === "docx") return `Word 解析失败：${message.slice(0, 160)}`;
  return `解析失败：${message.slice(0, 160)}`;
}
