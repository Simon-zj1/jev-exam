import type { QaCitation, QaIssue } from "@/lib/qa/types";
import type { EvidenceUnit } from "@/lib/retrieval";

/**
 * 引注校验：回答里出现的 [n] 必须真的对应一条证据，
 * 没有引注的实质性句子要被单独列出来，而不是混在答案里蒙混过去。
 */

export type CitationCheck = {
  /** 清掉非法编号后的正文 */
  answer: string;
  citations: QaCitation[];
  issues: QaIssue[];
  /** 被真正引用到的证据条数 */
  citedCount: number;
};

/** 支持 [1] 与全角【1】，以及 [1,2] / [1][2] 这类写法。 */
const MARKER_PATTERN = /\[(\d+(?:\s*[,，、]\s*\d+)*)\]|【(\d+(?:\s*[,，、]\s*\d+)*)】/g;

export function extractMarkers(answer: string): number[] {
  const markers: number[] = [];
  for (const match of answer.matchAll(MARKER_PATTERN)) {
    const group = match[1] ?? match[2] ?? "";
    for (const piece of group.split(/[,，、]/)) {
      const value = Number(piece.trim());
      if (Number.isFinite(value)) markers.push(value);
    }
  }
  return markers;
}

export function verifyCitations(
  rawAnswer: string,
  evidence: EvidenceUnit[],
  options: { pageOf?: (charOffset: number) => number | null } = {},
): CitationCheck {
  const issues: QaIssue[] = [];
  const used = new Set<number>();
  const unknown = new Set<number>();

  for (const marker of extractMarkers(rawAnswer)) {
    if (marker >= 1 && marker <= evidence.length) used.add(marker);
    else unknown.add(marker);
  }

  // 非法编号直接删掉：留着会让读者以为有出处
  let answer = rawAnswer;
  if (unknown.size > 0) {
    answer = answer.replace(MARKER_PATTERN, (whole, ascii, full) => {
      const group = String(ascii ?? full ?? "");
      const kept = group
        .split(/[,，、]/)
        .map((piece) => piece.trim())
        .filter((piece) => {
          const value = Number(piece);
          return Number.isFinite(value) && value >= 1 && value <= evidence.length;
        });
      return kept.length > 0 ? `[${kept.join(",")}]` : "";
    });
    issues.push({
      kind: "unknown_citation",
      detail: `回答引用了不存在的证据编号 ${[...unknown].sort((a, b) => a - b).join("、")}，已从正文中移除。`,
    });
  }

  const citations: QaCitation[] = [...used]
    .sort((a, b) => a - b)
    .map((marker) => {
      const unit = evidence[marker - 1];
      return {
        marker,
        unitIndex: unit.unitIndex,
        text: unit.text,
        charStart: unit.charStart,
        charEnd: unit.charEnd,
        page: options.pageOf?.(unit.charStart) ?? null,
        score: unit.score,
      };
    });

  const uncited = findUncitedSentences(answer);
  for (const sentence of uncited) {
    issues.push({
      kind: "uncited_sentence",
      detail: "这句没有标注材料出处。",
      excerpt: sentence,
    });
  }

  if (citations.length === 0) {
    issues.push({
      kind: "no_citation",
      detail: "整段回答没有任何材料出处，不能当作材料原文看待。",
    });
  }

  return { answer, citations, issues, citedCount: citations.length };
}

/**
 * 找出「实质性但没有引注」的句子：
 * - 纯标题（以「：」结尾）与太短的片段不算；
 * - 【模型补充】开头的句子本来就不该有引注，跳过。
 */
export function findUncitedSentences(answer: string): string[] {
  const sentences = answer
    .split(/(?<=[。！？!?])|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const sentence of sentences) {
    if (sentence.includes("【模型补充】")) continue;
    if (sentence.endsWith("：") || sentence.endsWith(":")) continue;
    if (extractMarkers(sentence).length > 0) continue;
    // 「材料里没有直接说明」这类如实说明不需要出处
    if (/^(材料里没有|材料中没有|没有找到)/.test(sentence)) continue;
    if (sentence.replace(/[\s\p{P}]/gu, "").length < 10) continue;
    result.push(sentence);
  }
  return result;
}

/** 统计正文里出现的「模型补充」标记，用于界面提示。 */
export function countModelSupplements(answer: string): number {
  return answer.split("【模型补充】").length - 1;
}
