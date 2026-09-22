import { NOUL_STRENGTH_THRESHOLD } from "@/lib/config";
import { normalizeText, truncate } from "@/lib/text";
import type {
  ClozeQuestion,
  DecisionEngine,
  Judgment,
  McqQuestion,
  TrueFalseQuestion,
} from "@/lib/types";

export function strengthOf(probability: number): number {
  return Math.abs(probability - 0.5) * 2;
}

function baseJudgment(overrides: Partial<Judgment>): Judgment {
  return {
    method: "exact",
    score: 0,
    scorePercent: 0,
    confidence: 1,
    needsReview: false,
    reviewReasons: [],
    usedEngine: false,
    points: [],
    penalties: [],
    engineId: "deterministic",
    model: "deterministic",
    latencyMs: 0,
    ...overrides,
  };
}

function makeScore(score: number): Pick<Judgment, "score" | "scorePercent"> {
  const clamped = Math.min(1, Math.max(0, score));
  return { score: clamped, scorePercent: Math.round(clamped * 100) };
}

export function gradeMcq(question: McqQuestion, index: number | null): Judgment {
  const correct = index !== null && index === question.correct_index;
  return baseJudgment({
    ...makeScore(correct ? 1 : 0),
    method: "exact",
    points: [],
    engineId: "deterministic",
    model: "deterministic",
  });
}

export function gradeTrueFalse(question: TrueFalseQuestion, value: boolean | null): Judgment {
  const correct = value !== null && value === question.answer;
  return baseJudgment({
    ...makeScore(correct ? 1 : 0),
    method: "exact",
  });
}

export function normalizeFillAnswer(input: string): string {
  return normalizeText(input).replace(/^(答案|answer)[:：]?/, "");
}

export function clozeMatches(question: ClozeQuestion, text: string): boolean {
  const candidates = [question.answer, ...question.accepted]
    .map(normalizeFillAnswer)
    .filter((candidate) => candidate.length > 0);
  const normalized = normalizeFillAnswer(text);
  return normalized.length > 0 && candidates.includes(normalized);
}

/**
 * 填空题：先做确定性比对；不一致时允许调用一次 noul 判断“语义等价”。
 * 这是方案里唯一交给 Jev 的客观题判定场景。
 */
export async function gradeCloze(
  question: ClozeQuestion,
  text: string,
  engine: DecisionEngine | null,
): Promise<Judgment> {
  if (clozeMatches(question, text)) {
    return baseJudgment({ ...makeScore(1), method: "exact" });
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return baseJudgment({ ...makeScore(0), method: "exact" });
  }

  if (!engine) {
    return baseJudgment({
      ...makeScore(0),
      method: "exact",
      needsReview: true,
      reviewReasons: ["semantic_check_unavailable"],
    });
  }

  const result = await engine.decide(
    {
      question: { stem: question.stem, text_with_blank: question.text_with_blank },
      reference: { answer: question.answer, accepted: question.accepted },
      student_answer: { text: trimmed },
    },
    {
      equivalent: {
        type: "noul",
        instructions: {
          question:
            "`student_answer.text` 与 `reference.answer` 在语义上是否等价？（允许同义改写、大小写与标点差异）",
          inspect: "`student_answer.text`",
          reference: "`reference`",
          focus: "只判断语义是否等价，不要求措辞相同。",
        },
      },
    },
  );

  const answer = result.answers.equivalent;
  const probability = answer?.type === "noul" ? answer.noul : 0.5;
  const strength = strengthOf(probability);
  const needsReview = strength < NOUL_STRENGTH_THRESHOLD;

  return baseJudgment({
    ...makeScore(probability >= 0.5 ? 1 : 0),
    method: "semantic",
    confidence: strength,
    needsReview,
    reviewReasons: needsReview ? ["low_confidence_semantic_match"] : [],
    engineId: result.engineId,
    model: result.model,
    latencyMs: result.latencyMs,
    usedEngine: true,
    raw: { probability, reference: truncate(question.answer, 60) },
  });
}
