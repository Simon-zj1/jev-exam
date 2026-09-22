import type { QuestionRecord } from "@/lib/db/types";
import type { GeneratedQuestion, RubricPoint } from "@/lib/types";

/** 把入库的题目还原成判定/展示用的题目结构。 */
export function toGeneratedQuestion(record: QuestionRecord): GeneratedQuestion {
  const base = {
    id: record.id,
    topic_id: record.topicId,
    stem: record.stem,
    difficulty: (["easy", "medium", "hard"].includes(record.difficulty)
      ? record.difficulty
      : "medium") as "easy" | "medium" | "hard",
    source_anchor: record.sourceAnchor,
    explanation: record.explanation ?? undefined,
  };

  switch (record.type) {
    case "mcq":
      return {
        ...base,
        type: "mcq",
        options: record.options ?? [],
        correct_index: record.answerKey.mcq?.correct_index ?? 0,
      };
    case "true_false":
      return {
        ...base,
        type: "true_false",
        answer: record.answerKey.true_false?.answer ?? true,
      };
    case "cloze":
      return {
        ...base,
        type: "cloze",
        text_with_blank: record.stem,
        answer: record.answerKey.cloze?.answer ?? "",
        accepted: record.answerKey.cloze?.accepted ?? [],
      };
    case "short_answer":
      return {
        ...base,
        type: "short_answer",
        reference_answer: record.answerKey.short_answer?.reference_answer ?? "",
        rubric_points:
          record.rubricPoints ?? record.answerKey.short_answer?.rubric_points ?? [],
      };
    default:
      throw new Error(`未知题型：${record.type}`);
  }
}

/** 面向学生的题目视图：绝不包含答案与 rubric。 */
export function toStudentQuestion(record: QuestionRecord) {
  return {
    id: record.id,
    type: record.type,
    stem: record.stem,
    options: record.options,
    topicTitle: record.topicTitle,
    difficulty: record.difficulty,
  };
}

export function rubricOf(record: QuestionRecord): RubricPoint[] {
  return record.rubricPoints ?? [];
}
