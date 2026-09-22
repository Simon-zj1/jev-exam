import { ANCHOR_MIN_LENGTH, DEDUPE_SIMILARITY_THRESHOLD } from "@/lib/config";
import { generatedQuestionSchema } from "@/lib/generator/schema";
import { normalizeText, similarity } from "@/lib/text";
import type { GeneratedQuestion } from "@/lib/types";

export type ValidationIssue = {
  index: number;
  code:
    | "schema_invalid"
    | "anchor_missing"
    | "anchor_too_short"
    | "duplicate"
    | "unknown_topic"
    | "empty_options";
  message: string;
  stem?: string;
};

export type AnchorMatch = {
  found: boolean;
  matchType: "exact" | "fuzzy" | "none";
  offset?: number;
};

/**
 * 在材料中定位锚点：先做归一化精确匹配，失败后退化为“分句覆盖率”模糊匹配。
 * 归一化会剥离空白与标点，因此换行、全半角差异都不影响定位。
 */
export function locateAnchor(material: string, anchor: string): AnchorMatch {
  const normalizedMaterial = normalizeText(material);
  const normalizedAnchor = normalizeText(anchor);
  if (normalizedAnchor.length === 0) return { found: false, matchType: "none" };

  const offset = normalizedMaterial.indexOf(normalizedAnchor);
  if (offset >= 0) return { found: true, matchType: "exact", offset };

  const chunks = anchor
    .split(/[。！？!?.\n；;]/)
    .map((chunk) => normalizeText(chunk))
    .filter((chunk) => chunk.length >= 4);
  if (chunks.length === 0) return { found: false, matchType: "none" };

  let hits = 0;
  for (const chunk of chunks) {
    if (normalizedMaterial.includes(chunk)) hits += 1;
  }
  const coverage = hits / chunks.length;
  if (coverage >= 0.7) return { found: true, matchType: "fuzzy" };
  return { found: false, matchType: "none" };
}

function dedupeKey(question: GeneratedQuestion): string {
  switch (question.type) {
    case "mcq":
      return `${question.stem}|${question.options[question.correct_index] ?? ""}`;
    case "cloze":
      return `${question.text_with_blank}|${question.answer}`;
    case "true_false":
      return `${question.stem}|${question.answer ? "T" : "F"}`;
    case "short_answer":
      return `${question.stem}|${question.reference_answer.slice(0, 60)}`;
  }
}

/**
 * 落地前校验：schema、锚点可定位、近似题目去重。
 * 返回可入库的题目与被丢弃的原因（丢弃只会让题量变少，不会让请求失败）。
 */
export function validateQuestions(
  candidates: unknown[],
  material: string,
  knownTopicIds: Set<string>,
): { valid: GeneratedQuestion[]; issues: ValidationIssue[] } {
  const valid: GeneratedQuestion[] = [];
  const issues: ValidationIssue[] = [];
  const acceptedKeys: string[] = [];

  candidates.forEach((candidate, index) => {
    const parsed = generatedQuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push({
        index,
        code: "schema_invalid",
        message: parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
      return;
    }

    const question = parsed.data as GeneratedQuestion;

    if (question.type === "mcq" && new Set(question.options.map(normalizeText)).size < 4) {
      issues.push({
        index,
        code: "empty_options",
        message: "选项重复或为空",
        stem: question.stem,
      });
      return;
    }

    if (knownTopicIds.size > 0 && !knownTopicIds.has(question.topic_id)) {
      issues.push({
        index,
        code: "unknown_topic",
        message: `topic_id=${question.topic_id} 不在大纲内`,
        stem: question.stem,
      });
      return;
    }

    if (normalizeText(question.source_anchor).length < Math.min(ANCHOR_MIN_LENGTH, 6)) {
      issues.push({
        index,
        code: "anchor_too_short",
        message: "source_anchor 过短，无法溯源",
        stem: question.stem,
      });
      return;
    }

    const anchor = locateAnchor(material, question.source_anchor);
    if (!anchor.found) {
      issues.push({
        index,
        code: "anchor_missing",
        message: "source_anchor 无法在材料中定位",
        stem: question.stem,
      });
      return;
    }

    const key = dedupeKey(question);
    const duplicated = acceptedKeys.some(
      (existing) => similarity(existing, key) >= DEDUPE_SIMILARITY_THRESHOLD,
    );
    if (duplicated) {
      issues.push({ index, code: "duplicate", message: "与已有题目近似重复", stem: question.stem });
      return;
    }

    acceptedKeys.push(key);
    valid.push(question);
  });

  return { valid, issues };
}
