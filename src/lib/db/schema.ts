import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnswerPayload } from "@/lib/grading";
import type { ExamConfigRecord } from "@/lib/db/types";
import type {
  AnswerKey,
  JudgmentPenalty,
  JudgmentPoint,
  RubricPoint,
  Topic,
} from "@/lib/types";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    byokEncrypted: text("byok_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const inviteCodes = pgTable("invite_codes", {
  code: text("code").primaryKey(),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const materials = pgTable(
  "materials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    rawText: text("raw_text").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("materials_user_idx").on(table.userId)],
);

export const examBlueprints = pgTable(
  "exam_blueprints",
  {
    id: text("id").primaryKey(),
    materialId: text("material_id").notNull(),
    version: integer("version").notNull().default(1),
    topics: jsonb("topics").$type<Topic[]>().notNull(),
    generatorModel: text("generator_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("exam_blueprints_material_unique").on(table.materialId)],
);

export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    materialId: text("material_id").notNull(),
    blueprintId: text("blueprint_id").notNull(),
    topicId: text("topic_id").notNull(),
    topicTitle: text("topic_title").notNull(),
    type: text("type").notNull(),
    stem: text("stem").notNull(),
    options: jsonb("options").$type<string[] | null>(),
    answerKey: jsonb("answer_key").$type<AnswerKey>().notNull(),
    rubricPoints: jsonb("rubric_points").$type<RubricPoint[] | null>(),
    sourceAnchor: text("source_anchor").notNull(),
    difficulty: text("difficulty").notNull(),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("questions_material_idx").on(table.materialId),
    index("questions_blueprint_idx").on(table.blueprintId),
  ],
);

export const exams = pgTable(
  "exams",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    materialId: text("material_id").notNull(),
    blueprintId: text("blueprint_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").$type<ExamConfigRecord>().notNull(),
    generatorModel: text("generator_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("exams_user_idx").on(table.userId)],
);

export const examQuestions = pgTable(
  "exam_questions",
  {
    examId: text("exam_id").notNull(),
    questionId: text("question_id").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.examId, table.questionId] })],
);

export const attempts = pgTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id").notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    scorePercent: integer("score_percent"),
    needsReviewCount: integer("needs_review_count"),
  },
  (table) => [index("attempts_exam_idx").on(table.examId)],
);

export const answers = pgTable(
  "answers",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id").notNull(),
    questionId: text("question_id").notNull(),
    payload: jsonb("payload").$type<AnswerPayload | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("answers_attempt_question_unique").on(table.attemptId, table.questionId)],
);

export const judgments = pgTable(
  "judgments",
  {
    id: text("id").primaryKey(),
    answerId: text("answer_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    questionId: text("question_id").notNull(),
    userId: text("user_id").notNull(),
    method: text("method").notNull(),
    score: doublePrecision("score").notNull(),
    scorePercent: integer("score_percent").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    needsReview: boolean("needs_review").notNull().default(false),
    reviewReasons: jsonb("review_reasons").$type<string[]>().notNull(),
    points: jsonb("points").$type<JudgmentPoint[]>().notNull(),
    penalties: jsonb("penalties").$type<JudgmentPenalty[]>().notNull(),
    scoreLow: doublePrecision("score_low"),
    scoreHigh: doublePrecision("score_high"),
    engineId: text("engine_id").notNull(),
    model: text("model").notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    request: jsonb("request"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("judgments_answer_unique").on(table.answerId),
    index("judgments_attempt_idx").on(table.attemptId),
  ],
);

export const mastery = pgTable(
  "mastery",
  {
    userId: text("user_id").notNull(),
    topicKey: text("topic_key").notNull(),
    topicTitle: text("topic_title").notNull(),
    value: doublePrecision("value").notNull(),
    sampleCount: integer("sample_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.topicKey] })],
);

export const mistakeItems = pgTable(
  "mistake_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    questionId: text("question_id").notNull(),
    materialId: text("material_id").notNull(),
    topicKey: text("topic_key").notNull(),
    topicTitle: text("topic_title").notNull(),
    lastScorePercent: integer("last_score_percent").notNull(),
    wrongCount: integer("wrong_count").notNull().default(1),
    lastAttemptId: text("last_attempt_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("mistake_items_user_question_unique").on(table.userId, table.questionId)],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day, table.kind] })],
);

/**
 * 复习排程：每张卡片对应一道题，按 FSRS 维护稳定度/难度与下次到期时间。
 * 它是「错题本」的升级版——错题本回答“错哪些”，这张表回答“什么时候该再练”。
 */
export const reviewItems = pgTable(
  "review_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    questionId: text("question_id").notNull(),
    materialId: text("material_id").notNull(),
    topicKey: text("topic_key").notNull(),
    topicTitle: text("topic_title").notNull(),
    stability: doublePrecision("stability").notNull(),
    difficulty: doublePrecision("difficulty").notNull(),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    state: text("state").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    lastScorePercent: integer("last_score_percent"),
    lastRating: integer("last_rating"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("review_items_user_question_unique").on(table.userId, table.questionId),
    index("review_items_due_idx").on(table.userId, table.dueAt),
  ],
);

/** 每次复习的记录，用于后续用真实数据拟合 FSRS 参数 */
export const reviewLogs = pgTable(
  "review_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    questionId: text("question_id").notNull(),
    rating: integer("rating").notNull(),
    scorePercent: integer("score_percent").notNull(),
    stabilityBefore: doublePrecision("stability_before").notNull(),
    difficultyBefore: doublePrecision("difficulty_before").notNull(),
    stabilityAfter: doublePrecision("stability_after").notNull(),
    difficultyAfter: doublePrecision("difficulty_after").notNull(),
    elapsedDays: doublePrecision("elapsed_days").notNull(),
    scheduledDays: doublePrecision("scheduled_days").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("review_logs_user_idx").on(table.userId, table.reviewedAt)],
);
