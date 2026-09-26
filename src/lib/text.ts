/** 文本归一化与相似度工具：客观题判分、锚点定位、去重都依赖它。 */

/**
 * 只归一化 CJK 兼容区字形（康熙部首、兼容汉字），不动全角标点。
 *
 * 有些 PDF 生成器会把「一」「文」「用」写成 U+2F00 这类康熙部首字形，
 * 直接存进材料就会满篇错字，中文分词（按 \u4e00-\u9fff 切）也会整块失效。
 * 不能整体 NFKC：那会把全角逗号、冒号也换成半角，破坏「逐字溯源」的保真度。
 */
const CJK_COMPATIBILITY = /[\u2e80-\u2fdf\uf900-\ufaff]|[\u{2f800}-\u{2fa1f}]/gu;

export function normalizeCjkCompatibility(input: string): string {
  if (!CJK_COMPATIBILITY.test(input)) return input;
  CJK_COMPATIBILITY.lastIndex = 0;
  return input.replace(CJK_COMPATIBILITY, (char) => char.normalize("NFKC"));
}

/**
 * 归一化：NFKC（全角→半角）、转小写、去掉标点与空白。
 * 中文标点与英文标点统一剥离，便于“异步/异步。”之类差异的对齐。
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "")
    .replace(/[、。，；：？！“”‘’（）《》〈〉【】—…·～「」『』]/g, "");
}

export function tokenizeForSimilarity(input: string): Set<string> {
  const normalized = normalizeText(input);
  const tokens = new Set<string>();
  for (const latin of normalized.match(/[a-z0-9]+/g) ?? []) {
    tokens.add(latin);
  }
  const han = normalized.match(/[\u4e00-\u9fff]/g) ?? [];
  if (han.length === 1) tokens.add(han[0]);
  for (let i = 0; i < han.length - 1; i += 1) {
    tokens.add(`${han[i]}${han[i + 1]}`);
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 字符 bigram Jaccard 相似度，用于题干去重与词面近似。 */
export function similarity(a: string, b: string): number {
  return jaccard(tokenizeForSimilarity(a), tokenizeForSimilarity(b));
}

export function countChars(input: string): number {
  return normalizeText(input).length;
}

/** 粗略 token 估算：中日韩字符按 1 token，其它按 4 字符 1 token。 */
export function estimateTokens(input: string): number {
  const han = (input.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const rest = input.length - han;
  return Math.ceil(han + rest / 4);
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max)}…`;
}

/**
 * 按中英文句末标点切句，忽略过短的碎片。
 * 既用于离线出题，也用于覆盖率校验里的「材料要点」单位。
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((sentence) => sentence.trim())
    // Markdown 标题不是知识要点，排除掉，避免它变成知识点或覆盖单位
    .filter((sentence) => !/^#{1,6}\s/.test(sentence))
    .filter((sentence) => sentence.length >= 8);
}
