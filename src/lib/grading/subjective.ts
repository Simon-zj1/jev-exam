import {
  CONTRADICTION_PENALTY,
  FABRICATION_PENALTY,
  KEY_POINT_MIN_WEIGHT,
  NOUL_STRENGTH_THRESHOLD,
} from "@/lib/config";
import { strengthOf } from "@/lib/grading/objective";
import { truncate } from "@/lib/text";
import type {
  DecisionEngine,
  DecisionQuestion,
  Judgment,
  JudgmentPenalty,
  JudgmentPoint,
  ShortAnswerQuestion,
} from "@/lib/types";

export const RUBRIC_SYSTEM_NOTE = [
  "每条 rubric 点对应一个独立问题；问题必须原子、可判定真假。",
  "以语义等价为准，不要求学生的措辞与参考答案一致。",
].join("\n");

export type SubjectiveInput = {
  question: ShortAnswerQuestion;
  answerText: string;
  engine: DecisionEngine;
  /** 该知识点对应的材料原文，用于“是否与材料矛盾”的判定 */
  materialExcerpt?: string;
  signal?: AbortSignal;
};

export function buildRubricQuestions(
  question: ShortAnswerQuestion,
  materialExcerpt: string | undefined,
): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {};

  for (const [index, point] of question.rubric_points.entries()) {
    questions[`point_${point.point_id}`] = {
      type: "noul",
      instructions: {
        // 每个问题必须自带它要判的那个得分点：问题之间是并行、独立的，
        // 共享同一段指令而只靠 key 区分，模型无法知道自己在判哪一点。
        question: "`answer.text` 是否覆盖了 `point.statement` 这一得分点？",
        inspect: "`answer.text`",
        point: {
          point_id: point.point_id,
          statement: point.statement,
          evidence_span: point.evidence_span,
          weight: point.weight,
          index,
        },
        focus: "只要语义上表达了该得分点即算覆盖，不要求措辞一致。",
      },
      criteria: {
        true: {
          what: "作答明确表达了该得分点的含义",
          examples: ["用同义表述说明了该点", "给出了该点的等价结论"],
        },
        false: {
          what: "作答没有表达该得分点",
          not_for: "仅仅提到相关名词但没有说明该点的含义",
          examples: ["完全未涉及", "表述与该点无关"],
        },
      },
    };
  }

  questions.contradicts = {
    type: "noul",
    instructions: {
      question:
        "`answer.text` 是否与 `rubric.reference_answer` 或 `material.excerpt` 的内容相互矛盾？",
      inspect: "`answer.text`",
      compare: ["`rubric.reference_answer`", "`material.excerpt`"],
      focus: "只有出现实质性冲突才算矛盾；遗漏内容不算矛盾。",
    },
  };

  questions.fabricates = {
    type: "noul",
    instructions: {
      question:
        "`answer.text` 是否引入了 `material.excerpt` 与 `rubric.reference_answer` 中都不存在的具体事实、数字或结论？",
      inspect: "`answer.text`",
      compare: ["`material.excerpt`", "`rubric.reference_answer`"],
      focus: "只针对具体的、可核对的事实性断言；一般性表述不算。",
    },
  };

  void materialExcerpt;
  return questions;
}

export function buildSubjectiveState(input: SubjectiveInput) {
  return {
    question: { stem: input.question.stem },
    rubric: {
      points: input.question.rubric_points.map((point) => ({
        point_id: point.point_id,
        statement: point.statement,
        evidence_span: point.evidence_span,
        weight: point.weight,
      })),
      reference_answer: input.question.reference_answer,
    },
    material: { excerpt: truncate(input.materialExcerpt ?? "", 4000) },
    answer: { text: truncate(input.answerText, 4000) },
  };
}

/**
 * 要点式主观题判定：
 * 1. 每个 rubric 点一条 noul → 概率即该点得分率
 * 2. 代码按权重合成，并施加“矛盾 / 编造”扣分
 * 3. 关键点判定强度过低 → 整题标记待复核，给出分数区间
 */
export async function gradeShortAnswer(input: SubjectiveInput): Promise<Judgment> {
  const questions = buildRubricQuestions(input.question, input.materialExcerpt);
  const state = buildSubjectiveState(input);
  const result = await input.engine.decide(state, questions, { signal: input.signal });

  const points: JudgmentPoint[] = [];
  const lowStrengthPoints: string[] = [];

  for (const point of input.question.rubric_points) {
    const answer = result.answers[`point_${point.point_id}`];
    const probability = answer?.type === "noul" ? answer.noul : 0.5;
    const strength = strengthOf(probability);
    points.push({
      point_id: point.point_id,
      statement: point.statement,
      weight: point.weight,
      probability,
      strength,
      awarded: probability >= 0.5,
    });
    if (point.weight >= KEY_POINT_MIN_WEIGHT && strength < NOUL_STRENGTH_THRESHOLD) {
      lowStrengthPoints.push(point.point_id);
    }
  }

  const penalties: JudgmentPenalty[] = [];
  const reviewReasons: string[] = [];

  const contradictions = result.answers.contradicts;
  const contradictionProbability =
    contradictions?.type === "noul" ? contradictions.noul : 0.5;
  if (contradictionProbability > 0.05) {
    penalties.push({
      kind: "contradiction",
      probability: contradictionProbability,
      weight: CONTRADICTION_PENALTY,
      label: "与材料或参考答案矛盾",
    });
  }
  if (strengthOf(contradictionProbability) < NOUL_STRENGTH_THRESHOLD) {
    reviewReasons.push("low_confidence_contradiction_check");
  }

  const fabrications = result.answers.fabricates;
  const fabricationProbability = fabrications?.type === "noul" ? fabrications.noul : 0.5;
  if (fabricationProbability > 0.05) {
    penalties.push({
      kind: "fabrication",
      probability: fabricationProbability,
      weight: FABRICATION_PENALTY,
      label: "引入了材料之外的具体事实",
    });
  }
  if (strengthOf(fabricationProbability) < NOUL_STRENGTH_THRESHOLD) {
    reviewReasons.push("low_confidence_fabrication_check");
  }

  for (const pointId of lowStrengthPoints) {
    reviewReasons.push(`low_confidence_point:${pointId}`);
  }

  const penaltyTotal =
    CONTRADICTION_PENALTY * contradictionProbability +
    FABRICATION_PENALTY * fabricationProbability;

  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0) || 1;
  const rawScore =
    points.reduce((sum, point) => sum + point.weight * point.probability, 0) / totalWeight;
  const score = clamp01(rawScore - penaltyTotal);

  const lowStrengthSet = new Set(lowStrengthPoints);
  const lower =
    points.reduce(
      (sum, point) => sum + point.weight * (lowStrengthSet.has(point.point_id) ? 0 : point.probability),
      0,
    ) /
      totalWeight -
    penaltyTotal;
  const upper =
    points.reduce(
      (sum, point) => sum + point.weight * (lowStrengthSet.has(point.point_id) ? 1 : point.probability),
      0,
    ) /
      totalWeight -
    penaltyTotal;

  const needsReview = lowStrengthPoints.length > 0 || reviewReasons.length > 0;
  const confidence = points.reduce(
    (min, point) => Math.min(min, point.strength),
    Number.POSITIVE_INFINITY,
  );

  return {
    method: "rubric",
    score,
    scorePercent: Math.round(score * 100),
    confidence: Number.isFinite(confidence) ? confidence : 1,
    needsReview,
    reviewReasons: [...new Set(reviewReasons)],
    usedEngine: true,
    scoreRange: needsReview ? [clamp01(lower), clamp01(upper)] : undefined,
    points,
    penalties,
    engineId: result.engineId,
    model: result.model,
    latencyMs: result.latencyMs,
    raw: { answers: result.answers },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
