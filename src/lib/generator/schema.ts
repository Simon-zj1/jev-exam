import { z } from "zod";

export const topicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  source_spans: z.array(z.string().min(1)).min(1).max(8),
});

export const outlineSchema = z.object({
  topics: z.array(topicSchema).min(1).max(24),
});

export const rubricPointSchema = z.object({
  point_id: z.string().min(1),
  statement: z.string().min(2).max(400),
  weight: z.number().positive().max(10),
  evidence_span: z.string().min(1),
});

const baseFields = {
  id: z.string().min(1),
  topic_id: z.string().min(1),
  stem: z.string().min(4).max(1200),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  source_anchor: z.string().min(1),
  explanation: z.string().max(1200).optional(),
};

export const mcqSchema = z.object({
  ...baseFields,
  type: z.literal("mcq"),
  options: z.array(z.string().min(1).max(400)).length(4),
  correct_index: z.number().int().min(0).max(3),
});

export const trueFalseSchema = z.object({
  ...baseFields,
  type: z.literal("true_false"),
  answer: z.boolean(),
});

export const clozeSchema = z.object({
  ...baseFields,
  type: z.literal("cloze"),
  text_with_blank: z.string().min(4).max(1200),
  answer: z.string().min(1).max(120),
  accepted: z.array(z.string().min(1).max(120)).default([]),
});

export const shortAnswerSchema = z.object({
  ...baseFields,
  type: z.literal("short_answer"),
  reference_answer: z.string().min(4).max(3000),
  rubric_points: z.array(rubricPointSchema).min(3).max(6),
});

export const generatedQuestionSchema = z.discriminatedUnion("type", [
  mcqSchema,
  trueFalseSchema,
  clozeSchema,
  shortAnswerSchema,
]);

export const generatedQuestionsPayloadSchema = z.object({
  questions: z.array(z.unknown()).min(1),
});
