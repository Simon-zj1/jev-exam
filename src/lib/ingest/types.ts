/**
 * 文档解析的结果契约。
 *
 * 解析出来的文字会原样成为材料正文，所以这里不保留任何中间结构；
 * 页面边界单独记录，用于把「答案出处」定位到具体页码（PDF 才有）。
 */

export type IngestKind = "pdf" | "docx" | "text";

export type IngestPage = {
  /** 从 1 开始，与阅读器里的页码一致 */
  page: number;
  /** 在最终 material 正文中的字符区间 */
  charStart: number;
  charEnd: number;
  charCount: number;
};

export type IngestResult = {
  kind: IngestKind;
  /** 由文件名推断的标题（去掉扩展名），用户可在保存前修改 */
  title: string;
  /** 已 trim 的正文；页面区间相对这段正文 */
  text: string;
  pageCount: number | null;
  pages: IngestPage[] | null;
  /** 面向用户的提示：哪一页没有文字、是否被截断、扫描件等 */
  warnings: string[];
  stats: {
    charCount: number;
    /** 完全没有提取到文字的页数（PDF 常见于扫描件） */
    emptyPageCount: number;
  };
};

export type SourceMap = {
  kind: IngestKind;
  fileName: string;
  pageCount: number | null;
  pages: IngestPage[] | null;
  warnings: string[];
};

/** 把字符偏移映射回页码；没有页面信息时返回 null。 */
export function pageAt(sourceMap: SourceMap | null | undefined, charOffset: number): number | null {
  const pages = sourceMap?.pages;
  if (!pages || pages.length === 0) return null;
  for (const page of pages) {
    if (charOffset >= page.charStart && charOffset < page.charEnd) return page.page;
  }
  return pages[pages.length - 1]?.page ?? null;
}
