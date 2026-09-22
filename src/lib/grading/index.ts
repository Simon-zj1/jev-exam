import { gradeCloze, gradeMcq, gradeTrueFalse } from "@/lib/grading/objective";
import { gradeShortAnswer } from "@/lib/grading/subjective";
import type {
  ClozeQuestion,
  DecisionEngine,
  GeneratedQuestion,
  Judgment,
  McqQuestion,
  ShortAnswerQuestion,
  TrueFalseQuestion,
} from "@/lib/types";

export type AnswerPayload =
  | { type: "mcq"; index: number | null }
  | { type: "true_false"; value: boolean | null }
  | { type: "cloze"; text: string }
  | { type: "short_answer"; text: string };

export type GradeContext = {
  engine: DecisionEngine | null;
  materialExcerpt?: string;
  signal?: AbortSignal;
};

export async function gradeQuestion(
  question: GeneratedQuestion,
  payload: AnswerPayload | null,
  context: GradeContext,
): Promise<Judgment> {
  switch (question.type) {
    case "mcq":
      return gradeMcq(question as McqQuestion, payload?.type === "mcq" ? payload.index : null);
    case "true_false":
      return gradeTrueFalse(
        question as TrueFalseQuestion,
        payload?.type === "true_false" ? payload.value : null,
      );
    case "cloze":
      return gradeCloze(
        question as ClozeQuestion,
        payload?.type === "cloze" ? payload.text : "",
        context.engine,
      );
    case "short_answer": {
      if (!context.engine) {
        return {
          method: "rubric",
          score: 0,
          scorePercent: 0,
          confidence: 0,
          needsReview: true,
          reviewReasons: ["engine_unavailable"],
          usedEngine: false,
          points: (question as ShortAnswerQuestion).rubric_points.map((point) => ({
            point_id: point.point_id,
            statement: point.statement,
            weight: point.weight,
            probability: 0.5,
            strength: 0,
            awarded: false,
          })),
          penalties: [],
          engineId: "unavailable",
          model: "unavailable",
          latencyMs: 0,
          raw: null,
        };
      }
      return gradeShortAnswer({
        question: question as ShortAnswerQuestion,
        answerText: payload?.type === "short_answer" ? payload.text : "",
        engine: context.engine,
        materialExcerpt: context.materialExcerpt,
        signal: context.signal,
      });
    }
  }
}

export { buildRubricQuestions, gradeShortAnswer } from "@/lib/grading/subjective";
export { gradeCloze, gradeMcq, gradeTrueFalse } from "@/lib/grading/objective";
export { clozeMatches, normalizeFillAnswer, strengthOf } from "@/lib/grading/objective";
