/** 文本归一化与相似度工具：客观题判分、锚点定位、去重都依赖它。 */

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
