import type { IngestPage } from "@/lib/ingest/types";

/**
 * 上传体检。
 *
 * 第一次上传的往往是扫描件、拍照书页或排版稀疏的讲义。静默给出一份残缺材料是最坏的结果，
 * 所以这里把「能解析到什么程度」变成一份可读结论：哪些检查过了、哪些要留意、要不要补传。
 */

export type HealthStatus = "pass" | "warn" | "fail";

export type HealthCheck = {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
};

export type IngestHealth = {
  level: "good" | "fair" | "poor";
  summary: string;
  checks: HealthCheck[];
};

export type DiagnoseInput = {
  kind: string;
  text: string;
  pageCount: number | null;
  pages: IngestPage[] | null;
  emptyPageCount: number;
};

export function diagnoseIngest(input: DiagnoseInput): IngestHealth {
  const checks: HealthCheck[] = [];
  const charCount = input.text.length;
  const lines = input.text.split("\n").filter((line) => line.trim().length > 0);
  const pageCount = input.pageCount;
  const textPages = input.pages?.filter((page) => page.charCount > 0).length ?? null;

  // 1. 文字覆盖率：PDF 最能说明问题——有文字的页占多少
  if (pageCount !== null && textPages !== null) {
    const ratio = pageCount === 0 ? 0 : textPages / pageCount;
    const percent = Math.round(ratio * 100);
    if (ratio >= 0.8) {
      checks.push({
        id: "page_coverage",
        label: "文字覆盖率",
        status: "pass",
        detail: `${textPages}/${pageCount} 页提取到文字（${percent}%）。`,
      });
    } else if (ratio >= 0.4) {
      checks.push({
        id: "page_coverage",
        label: "文字覆盖率",
        status: "warn",
        detail: `只有 ${textPages}/${pageCount} 页提取到文字（${percent}%），其余多半是扫描或图片页，这部分不会被出题覆盖。`,
      });
    } else {
      checks.push({
        id: "page_coverage",
        label: "文字覆盖率",
        status: "fail",
        detail: `仅 ${textPages}/${pageCount} 页有文字（${percent}%）。这份文件很可能是扫描件，建议先做 OCR 再上传。`,
      });
    }
  }

  // 2. 正文体量：太少则考点不足以出一套题
  if (charCount >= 500) {
    checks.push({
      id: "volume",
      label: "正文体量",
      status: "pass",
      detail: `${charCount} 字符，足够切分出多个知识点。`,
    });
  } else if (charCount >= 200) {
    checks.push({
      id: "volume",
      label: "正文体量",
      status: "warn",
      detail: `只有 ${charCount} 字符，可能只够出一两道题；建议补充同章节的材料。`,
    });
  } else {
    checks.push({
      id: "volume",
      label: "正文体量",
      status: "fail",
      detail: `只有 ${charCount} 字符，内容太少，出题与判定的价值都会很低。`,
    });
  }

  // 3. 版式还原：整段挤在一起说明换行没被还原
  if (lines.length >= 5) {
    checks.push({
      id: "layout",
      label: "段落还原",
      status: "pass",
      detail: `识别出 ${lines.length} 个自然段/行。`,
    });
  } else if (lines.length >= 2) {
    checks.push({
      id: "layout",
      label: "段落还原",
      status: "warn",
      detail: "正文几乎没有分段，可能是整页文本被拼成了一整段；出处仍可逐句定位，但阅读体验会差。",
    });
  } else {
    checks.push({
      id: "layout",
      label: "段落还原",
      status: "fail",
      detail: "正文只有一段且没有换行，解析质量可疑，建议换一份更清晰的文件。",
    });
  }

  // 4. 乱码/替换字符：字体映射失败时会出现大量 U+FFFD
  const replacement = (input.text.match(/\uFFFD/g) ?? []).length;
  const replacementRatio = charCount === 0 ? 0 : replacement / charCount;
  if (replacementRatio > 0.01) {
    checks.push({
      id: "mojibake",
      label: "字符质量",
      status: "fail",
      detail: `有 ${replacement} 个无法识别的字符（${Math.round(replacementRatio * 100)}%），编码或字体映射可能有问题。`,
    });
  } else if (replacement > 0) {
    checks.push({
      id: "mojibake",
      label: "字符质量",
      status: "warn",
      detail: `有 ${replacement} 个无法识别的字符，个别地方可能需要手动修正。`,
    });
  } else {
    checks.push({
      id: "mojibake",
      label: "字符质量",
      status: "pass",
      detail: "没有发现无法识别的乱码字符。",
    });
  }

  // 5. 页码定位能力：能给出处到页，用户更愿意核对
  if (input.pages && textPages && textPages > 0) {
    checks.push({
      id: "page_mapping",
      label: "页码追溯",
      status: "pass",
      detail: "已记录页码映射，答案出处可以定位到「第几页」。",
    });
  } else {
    checks.push({
      id: "page_mapping",
      label: "页码追溯",
      status: "warn",
      detail:
        input.kind === "docx"
          ? "Word 没有固定页码，出处只能定位到原文句子。"
          : "没有页码信息，出处只能定位到原文句子。",
    });
  }

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  const level: IngestHealth["level"] =
    failed.length > 0 ? "poor" : warned.length >= 2 ? "fair" : "good";

  const summary =
    level === "good"
      ? "解析结果可用，可以直接出题。"
      : level === "fair"
        ? `基本可用，但有 ${warned.length} 处需要留意（见下）。`
        : "解析质量不理想：建议先处理下面的问题再出题，否则题目会基于残缺内容。";

  return { level, summary, checks };
}
