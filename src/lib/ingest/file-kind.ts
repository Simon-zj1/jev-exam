import type { IngestKind } from "@/lib/ingest/types";

/**
 * 只按内容嗅探类型，不信任扩展名与 MIME：
 * 浏览器给出的 Content-Type 经常是 application/octet-stream，
 * 而用户改扩展名是常见操作，按内容判断才不会把二进制当文本处理。
 */

export type DetectedFile = {
  kind: IngestKind | "doc" | "unknown";
  /** 面向用户的中文说明 */
  label: string;
  /** 该类型是否可以解析 */
  supported: boolean;
};

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".text"];

export function detectFileKind(buffer: Uint8Array, fileName: string): DetectedFile {
  const lower = fileName.toLowerCase();

  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) {
    // %PDF
    return { kind: "pdf", label: "PDF 文档", supported: true };
  }

  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    // PK.. ：docx 本身是 zip；其它 zip 归档按扩展名区分
    if (lower.endsWith(".docx")) {
      return { kind: "docx", label: "Word 文档（.docx）", supported: true };
    }
    return { kind: "unknown", label: "未知的压缩包格式", supported: false };
  }

  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { kind: "doc", label: "旧版 Word（.doc）", supported: false };
  }

  if (TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return { kind: "text", label: "纯文本", supported: true };
  }

  if (!looksBinary(buffer)) {
    return { kind: "text", label: "纯文本", supported: true };
  }

  return { kind: "unknown", label: "无法识别的文件类型", supported: false };
}

function startsWith(buffer: Uint8Array, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

/** 出现 NUL 字节基本可以判定是二进制；纯文本偶尔带 BOM 但不含 NUL。 */
function looksBinary(buffer: Uint8Array): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  return base.replace(/\.[^.]+$/, "").trim() || "未命名材料";
}
