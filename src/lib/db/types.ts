import type { QuotaKind, QuestionType } from "@/lib/config";
import type { AnswerPayload } from "@/lib/grading";
import type { SourceMap } from "@/lib/ingest/types";
import type {
  AnswerKey,
  JudgmentMethod,
  JudgmentPenalty,
  JudgmentPoint,
  RubricPoint,
  Topic,
} from "@/lib/types";

export type ExamConfigRecord = {
  mix: Record<QuestionType, number>;
  count: number;
  topicIds: string[];
};

export type UserRecord = {
  id: string;
  email: string;
  byokEncrypted: string | null;
  createdAt: Date;
};

export type InviteCodeRecord = {
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  createdAt: Date;
};

export type MaterialRecord = {
  id: string;
  userId: string;
  title: string;
  rawText: string;
  tokenCount: number;
  contentHash: string;
  sourceMap: SourceMap | null;
  createdAt: Date;
};

export type NewMaterial = Omit<MaterialRecord, "id" | "createdAt" | "sourceMap"> & {
  sourceMap?: SourceMap | null;
};

export type BlueprintRecord = {
  id: string;
  materialId: string;
  version: number;
  topics: Topic[];
  generatorModel: string;
  createdAt: Date;
};

export type NewBlueprint = Omit<BlueprintRecord, "id" | "createdAt" | "version"> & {
  version?: number;
};

export type QuestionRecord = {
  id: string;
  materialId: string;
  blueprintId: string;
  topicId: string;
  topicTitle: string;
  type: QuestionType;
  stem: string;
  options: string[] | null;
  answerKey: AnswerKey;
  rubricPoints: RubricPoint[] | null;
  sourceAnchor: string;
  difficulty: string;
  explanation: string | null;
  createdAt: Date;
};

export type NewQuestion = Omit<QuestionRecord, "createdAt">;

export type ExamRecord = {
  id: string;
  userId: string;
  materialId: string;
  blueprintId: string;
  title: string;
  kind: "generated" | "mistake_retry";
  config: ExamConfigRecord;
  generatorModel: string;
  createdAt: Date;
};

export type NewExam = Omit<ExamRecord, "id" | "createdAt">;

export type AttemptRecord = {
  id: string;
  examId: string;
  userId: string;
  status: "in_progress" | "submitted";
  startedAt: Date;
  submittedAt: Date | null;
  scorePercent: number | null;
  needsReviewCount: number | null;
};

export type AnswerRecord = {
  id: string;
  attemptId: string;
  questionId: string;
  payload: AnswerPayload | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JudgmentRecord = {
  id: string;
  answerId: string;
  attemptId: string;
  questionId: string;
  userId: string;
  method: JudgmentMethod;
  score: number;
  scorePercent: number;
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
  points: JudgmentPoint[];
  penalties: JudgmentPenalty[];
  scoreLow: number | null;
  scoreHigh: number | null;
  engineId: string;
  model: string;
  latencyMs: number;
  request: unknown;
  response: unknown;
  createdAt: Date;
};

export type NewJudgment = Omit<JudgmentRecord, "id" | "createdAt">;

export type MasteryRecord = {
  userId: string;
  topicKey: string;
  topicTitle: string;
  value: number;
  sampleCount: number;
  updatedAt: Date;
};

export type MistakeRecord = {
  id: string;
  userId: string;
  questionId: string;
  materialId: string;
  topicKey: string;
  topicTitle: string;
  lastScorePercent: number;
  wrongCount: number;
  lastAttemptId: string;
  updatedAt: Date;
};

export type NewMistake = Omit<MistakeRecord, "id" | "updatedAt" | "wrongCount"> & {
  /** 追加一次错误；重考答对时传 false 表示修正记录 */
  increment?: boolean;
};

export type UsageSnapshot = Record<QuotaKind, number>;

export type ReviewItemRecord = {
  id: string;
  userId: string;
  questionId: string;
  materialId: string;
  topicKey: string;
  topicTitle: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: "new" | "learning" | "review" | "relearning";
  dueAt: Date;
  lastReviewedAt: Date | null;
  lastScorePercent: number | null;
  lastRating: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewReviewItem = Omit<ReviewItemRecord, "id" | "createdAt" | "updatedAt">;

export type ReviewLogRecord = {
  id: string;
  userId: string;
  questionId: string;
  rating: number;
  scorePercent: number;
  stabilityBefore: number;
  difficultyBefore: number;
  stabilityAfter: number;
  difficultyAfter: number;
  elapsedDays: number;
  scheduledDays: number;
  reviewedAt: Date;
};

export type NewReviewLog = Omit<ReviewLogRecord, "id" | "reviewedAt"> & { reviewedAt?: Date };

/** 纠错上报的类型：用户认为哪里错了 */
export type FeedbackKind = "wrong_score" | "wrong_reference" | "bad_question" | "other";

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  wrong_score: "判定分数不对",
  wrong_reference: "参考答案不对",
  bad_question: "题目本身有问题",
  other: "其它问题",
};

/**
 * 上报时冻结的现场快照。
 * 判定逻辑会迭代，只留 questionId 的话，之后回看已经无法复原当时判了什么。
 */
export type FeedbackSnapshot = {
  materialTitle: string;
  questionType: string;
  stem: string;
  payload: AnswerPayload | null;
  scorePercent: number | null;
  needsReview: boolean;
  engineId: string | null;
  engineModel: string | null;
  referenceAnswer: string | null;
  points: { point_id: string; statement: string; probability: number; awarded: boolean }[];
};

export type FeedbackRecord = {
  id: string;
  userId: string;
  questionId: string;
  attemptId: string | null;
  kind: FeedbackKind;
  note: string | null;
  snapshot: FeedbackSnapshot;
  status: string;
  createdAt: Date;
};

export type NewFeedback = Omit<FeedbackRecord, "id" | "createdAt" | "status"> & {
  status?: string;
};

export type LlmUsageDelta = {
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
};

export type LlmUsageRecord = {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

export interface Store {
  createUser(email: string): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  setUserByok(userId: string, encrypted: string | null): Promise<void>;

  upsertInviteCode(code: string, maxUses: number, expiresAt?: Date | null): Promise<InviteCodeRecord>;
  getInviteCode(code: string): Promise<InviteCodeRecord | null>;
  consumeInviteCode(code: string): Promise<boolean>;

  createMaterial(input: NewMaterial): Promise<MaterialRecord>;
  getMaterial(id: string): Promise<MaterialRecord | null>;
  listMaterials(userId: string): Promise<MaterialRecord[]>;
  deleteMaterial(id: string, userId: string): Promise<boolean>;

  saveBlueprint(input: NewBlueprint): Promise<BlueprintRecord>;
  getBlueprintById(id: string): Promise<BlueprintRecord | null>;
  getBlueprintByMaterial(materialId: string): Promise<BlueprintRecord | null>;

  createQuestions(inputs: NewQuestion[]): Promise<QuestionRecord[]>;
  getQuestion(id: string): Promise<QuestionRecord | null>;
  getQuestions(ids: string[]): Promise<QuestionRecord[]>;
  listQuestionsByMaterial(materialId: string): Promise<QuestionRecord[]>;

  createExam(
    input: NewExam,
    questions: { questionId: string; position: number }[],
  ): Promise<ExamRecord>;
  getExam(id: string): Promise<ExamRecord | null>;
  listExams(userId: string): Promise<ExamRecord[]>;
  listExamQuestionIds(examId: string): Promise<string[]>;

  createAttempt(examId: string, userId: string): Promise<AttemptRecord>;
  getAttempt(id: string): Promise<AttemptRecord | null>;
  getOpenAttempt(examId: string, userId: string): Promise<AttemptRecord | null>;
  listAttemptsByUser(userId: string): Promise<AttemptRecord[]>;
  saveAnswer(
    attemptId: string,
    questionId: string,
    payload: AnswerPayload | null,
  ): Promise<AnswerRecord>;
  listAnswers(attemptId: string): Promise<AnswerRecord[]>;
  submitAttempt(
    id: string,
    summary: { scorePercent: number; needsReviewCount: number; submittedAt: Date },
  ): Promise<void>;

  saveJudgment(input: NewJudgment): Promise<JudgmentRecord>;
  getJudgmentByAnswer(answerId: string): Promise<JudgmentRecord | null>;
  listJudgmentsByAttempt(attemptId: string): Promise<JudgmentRecord[]>;

  applyMastery(
    userId: string,
    topicKey: string,
    topicTitle: string,
    score: number,
  ): Promise<MasteryRecord>;
  listMastery(userId: string): Promise<MasteryRecord[]>;

  upsertMistake(input: NewMistake): Promise<MistakeRecord>;
  listMistakes(userId: string): Promise<MistakeRecord[]>;
  deleteMistake(userId: string, questionId: string): Promise<boolean>;

  incrementUsage(userId: string, day: string, kind: QuotaKind, amount: number): Promise<number>;
  getUsage(userId: string, day: string): Promise<UsageSnapshot>;

  incrementLlmUsage(
    userId: string,
    day: string,
    model: string,
    delta: LlmUsageDelta,
  ): Promise<LlmUsageRecord>;
  listLlmUsage(userId: string, day: string): Promise<LlmUsageRecord[]>;
  /** 平台级熔断用：当天所有用户的合计用量 */
  sumLlmUsageForDay(day: string): Promise<LlmUsageDelta>;

  createFeedback(input: NewFeedback): Promise<FeedbackRecord>;
  /** userId 为 null 时返回全部用户的上报（供本地导出脚本用） */
  listFeedback(userId: string | null): Promise<FeedbackRecord[]>;

  /** 删除账号：连同该用户的全部派生数据一起删 */
  deleteUserData(userId: string): Promise<void>;

  upsertReviewItem(input: NewReviewItem): Promise<ReviewItemRecord>;
  getReviewItem(userId: string, questionId: string): Promise<ReviewItemRecord | null>;
  listReviewItems(userId: string): Promise<ReviewItemRecord[]>;
  listDueReviewItems(userId: string, dueBefore: Date, limit: number): Promise<ReviewItemRecord[]>;
  deleteReviewItem(userId: string, questionId: string): Promise<boolean>;
  saveReviewLog(input: NewReviewLog): Promise<ReviewLogRecord>;

  /** 测试与本地重置用 */
  reset(): Promise<void>;
}
