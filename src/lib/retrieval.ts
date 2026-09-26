import { splitSentences } from "@/lib/text";

/**
 * 材料内的证据检索。
 *
 * 这里刻意不引入向量库：材料是用户当场粘贴/上传的一份文本，规模在几百句量级，
 * 词面检索（带 IDF 的加权重合）已经够用，而且完全可解释——为什么选出这一句，
 * 可以逐项核对。真正不可解释的那部分（生成答案）才交给模型，并且要求它标引。
 *
 * 局限如实写在返回结构里：检索不到就是检索不到，绝不会「用模型的记忆补上」。
 */

export type EvidenceUnit = {
  /** 在材料分句序列里的序号，从 0 开始；引用编号与出处都基于它 */
  unitIndex: number;
  /** 材料原文（逐字，未改写） */
  text: string;
  /** 在材料中的字符偏移，用于定位页码 */
  charStart: number;
  charEnd: number;
  /** 检索得分，用于排序与调试 */
  score: number;
};

export type RetrievalResult = {
  query: string;
  /** 按得分降序的证据 */
  evidence: EvidenceUnit[];
  /** 命中了多少个查询词（用于判断「材料里到底有没有」） */
  matchedTermCount: number;
  queryTermCount: number;
  /** 材料被切成多少个单位 */
  unitCount: number;
};

type Unit = {
  unitIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
  tokens: Set<string>;
  /** 词 -> 在该单位出现的次数，用于 TF 加权 */
  termFrequency: Map<string, number>;
};

/**
 * 检索用的分词：英文按单词、中文按二元组。
 *
 * 不能直接复用 similarity 的分词器——它为了比较整句相似度会把空白去掉，
 * 结果是整段英文被当成一个 token（"vectorsearchencodes..."），
 * 英文提问就永远检索不到任何东西。这里按词切，并对英文做一次轻量的复数还原。
 */
export function tokenizeForRetrieval(input: string): Set<string> {
  const normalized = input.normalize("NFKC").toLowerCase();
  const tokens = new Set<string>();

  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 2) continue;
    tokens.add(word);
    // 只做最保守的一步还原：复数与三单的 s/es
    if (word.length > 3 && word.endsWith("es")) tokens.add(word.slice(0, -2));
    else if (word.length > 3 && word.endsWith("s")) tokens.add(word.slice(0, -1));
  }

  for (const run of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) tokens.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
  }

  return tokens;
}

/** 切分材料并记录每个单位在原文中的偏移；splitSentences 会丢标点，所以用 indexOf 回推。 */
export function buildUnits(material: string): Unit[] {
  const sentences = splitSentences(material);
  const units: Unit[] = [];
  let cursor = 0;

  sentences.forEach((sentence, index) => {
    const found = material.indexOf(sentence, cursor);
    const charStart = found >= 0 ? found : cursor;
    const charEnd = charStart + sentence.length;
    cursor = charEnd;

    const tokens = tokenizeForRetrieval(sentence);
    const termFrequency = new Map<string, number>();
    for (const token of tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
    units.push({ unitIndex: index, text: sentence, charStart, charEnd, tokens, termFrequency });
  });

  return units;
}

/**
 * 词面检索：TF × IDF 的余弦式打分。
 * 中文按字符 bigram 切，英文按单词切（见 tokenizeForSimilarity），
 * 因此「向量检索」和「vector search」都能命中，但同义改写命中不了——这是已知取舍。
 */
export function retrieveEvidence(
  material: string,
  query: string,
  options: { topK?: number; minScore?: number } = {},
): RetrievalResult {
  const topK = options.topK ?? 6;
  const minScore = options.minScore ?? 0.01;

  const units = buildUnits(material);
  const queryTokens = tokenizeForRetrieval(query);
  const queryTermCount = queryTokens.size;

  if (units.length === 0 || queryTermCount === 0) {
    return { query, evidence: [], matchedTermCount: 0, queryTermCount, unitCount: units.length };
  }

  const documentFrequency = new Map<string, number>();
  for (const unit of units) {
    for (const token of unit.tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const matchedTerms = new Set<string>();
  const scored = units.map((unit) => {
    let score = 0;
    for (const token of queryTokens) {
      const frequency = unit.termFrequency.get(token) ?? 0;
      if (frequency === 0) continue;
      matchedTerms.add(token);
      const df = documentFrequency.get(token) ?? 1;
      // 平滑 IDF：出现在越少单位里的词越有区分度
      const idf = Math.log((units.length + 1) / (df + 0.5));
      score += (1 + Math.log(frequency)) * Math.max(idf, 0.05);
    }
    // 长度归一，避免长句仅因为词多而占优
    return { unit, score: score / Math.sqrt(Math.max(unit.tokens.size, 1)) };
  });

  const evidence = scored
    .filter((entry) => entry.score > minScore)
    .sort((a, b) => b.score - a.score || a.unit.unitIndex - b.unit.unitIndex)
    .slice(0, topK)
    // 按原文顺序返回，方便读者顺着材料读
    .sort((a, b) => a.unit.unitIndex - b.unit.unitIndex)
    .map((entry) => ({
      unitIndex: entry.unit.unitIndex,
      text: entry.unit.text,
      charStart: entry.unit.charStart,
      charEnd: entry.unit.charEnd,
      score: entry.score,
    }));

  return {
    query,
    evidence,
    matchedTermCount: matchedTerms.size,
    queryTermCount,
    unitCount: units.length,
  };
}
