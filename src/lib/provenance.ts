import { locateAnchor } from "@/lib/generator/validate";
import { normalizeText, splitSentences } from "@/lib/text";
import type { GeneratedQuestion } from "@/lib/types";

/**
 * 溯源契约：把「材料事实」与「模型补充」分开，并且可校验。
 *
 * 这是从 learn-from-materials 学到的关键约束——只有把两类内容显式分开，
 * 用户才可能知道哪句话是材料里有的、哪句话是模型说的。
 */

export type Origin = "material" | "model";

export type ProvenanceRule = {
  path: string;
  origin: Origin;
  label: string;
  rule: string;
};

export const PROVENANCE_CONTRACT: ProvenanceRule[] = [
  {
    path: "question.source_anchor",
    origin: "material",
    label: "题目出处",
    rule: "必须逐字出现在材料中；定位失败则整题视为未核验。",
  },
  {
    path: "rubric_point.evidence_span",
    origin: "material",
    label: "得分点依据",
    rule: "必须逐字出现在材料中；定位失败则该得分点不可作为计分依据。",
  },
  {
    path: "question.stem / options / reference_answer",
    origin: "model",
    label: "题干与参考答案",
    rule: "由模型基于材料生成，允许改写措辞；不能当作材料原文引用。",
  },
  {
    path: "rubric_point.statement",
    origin: "model",
    label: "得分点表述",
    rule: "模型对材料要点的转写，用于判定；与原文一致性由 evidence_span 保证。",
  },
  {
    path: "judgment.*",
    origin: "model",
    label: "判定结果",
    rule: "决策模型给出的概率与置信度，不是材料事实。",
  },
  {
    path: "explanation",
    origin: "model",
    label: "解释文字",
    rule: "模型补充的说明，材料里没有这句话。",
  },
];

export function originLabel(origin: Origin): string {
  return origin === "material" ? "材料原文" : "模型补充";
}

export type ProvenanceViolation = {
  questionId: string;
  field: string;
  value: string;
  reason: string;
};

/**
 * 校验契约里所有标记为 material 的字段：必须能在原文定位，
 * 且不能因为注入内容而被「凭空生成」出来。
 */
export function verifyProvenance(
  material: string,
  questions: GeneratedQuestion[],
): ProvenanceViolation[] {
  const violations: ProvenanceViolation[] = [];

  for (const question of questions) {
    if (!question.source_anchor.trim()) {
      violations.push({
        questionId: question.id,
        field: "source_anchor",
        value: "",
        reason: "缺少题目出处",
      });
    } else if (!locateAnchor(material, question.source_anchor).found) {
      violations.push({
        questionId: question.id,
        field: "source_anchor",
        value: question.source_anchor,
        reason: "题目出处无法在材料中定位",
      });
    }

    if (question.type !== "short_answer") continue;
    for (const point of question.rubric_points) {
      if (!point.evidence_span.trim()) {
        violations.push({
          questionId: question.id,
          field: `rubric_point.${point.point_id}.evidence_span`,
          value: "",
          reason: "得分点缺少材料依据",
        });
        continue;
      }
      if (!locateAnchor(material, point.evidence_span).found) {
        violations.push({
          questionId: question.id,
          field: `rubric_point.${point.point_id}.evidence_span`,
          value: point.evidence_span,
          reason: "得分点依据无法在材料中定位",
        });
      }
    }
  }

  return violations;
}

/**
 * 记录某段文本在材料中的位置（段序号 + 归一化字符区间），
 * 用于结果页与报告里显示「原文出处」的范围，而不是只丢一句原文。
 */
export type SourceLocation = {
  found: boolean;
  /** 材料里的第几个「要点单位」（按句子切分），从 0 开始 */
  unitIndex: number | null;
  unitCount: number;
  charRange: [number, number] | null;
};

export function locateSource(material: string, anchor: string): SourceLocation {
  const match = locateAnchor(material, anchor);
  const units = splitSentences(material);
  if (!match.found) {
    return { found: false, unitIndex: null, unitCount: units.length, charRange: null };
  }

  const normalizedAnchor = normalizeText(anchor);
  const probe = normalizedAnchor.slice(0, Math.min(12, normalizedAnchor.length));
  const unitIndex = units.findIndex(
    (unit) => normalizeText(unit).includes(probe) || probe.includes(normalizeText(unit).slice(0, 12)),
  );

  return {
    found: true,
    unitIndex: unitIndex >= 0 ? unitIndex : null,
    unitCount: units.length,
    charRange: match.offset !== undefined ? [match.offset, match.offset + normalizedAnchor.length] : null,
  };
}
