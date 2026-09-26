import { QUOTA_LIMITS, type QuotaKind } from "@/lib/config";
import { createId } from "@/lib/ids";
import type {
  AnswerRecord,
  AttemptRecord,
  BlueprintRecord,
  ExamRecord,
  InviteCodeRecord,
  JudgmentRecord,
  MasteryRecord,
  MaterialRecord,
  MistakeRecord,
  NewBlueprint,
  NewExam,
  NewJudgment,
  NewMaterial,
  NewMistake,
  NewQuestion,
  NewReviewItem,
  NewReviewLog,
  QuestionRecord,
  ReviewItemRecord,
  ReviewLogRecord,
  Store,
  UsageSnapshot,
  UserRecord,
} from "@/lib/db/types";
import { normalizeEmail } from "@/lib/auth/email";
import type { AnswerPayload } from "@/lib/grading";

const MASTERY_ALPHA = 0.3;

type MemoryState = {
  users: Map<string, UserRecord>;
  inviteCodes: Map<string, InviteCodeRecord>;
  materials: Map<string, MaterialRecord>;
  blueprints: Map<string, BlueprintRecord>;
  questions: Map<string, QuestionRecord>;
  exams: Map<string, ExamRecord>;
  examQuestions: Map<string, { questionId: string; position: number }[]>;
  attempts: Map<string, AttemptRecord>;
  answers: Map<string, AnswerRecord>;
  judgments: Map<string, JudgmentRecord>;
  mastery: Map<string, MasteryRecord>;
  mistakes: Map<string, MistakeRecord>;
  usage: Map<string, number>;
  reviewItems: Map<string, ReviewItemRecord>;
  reviewLogs: ReviewLogRecord[];
};

function emptyState(): MemoryState {
  return {
    users: new Map(),
    inviteCodes: new Map(),
    materials: new Map(),
    blueprints: new Map(),
    questions: new Map(),
    exams: new Map(),
    examQuestions: new Map(),
    attempts: new Map(),
    answers: new Map(),
    judgments: new Map(),
    mastery: new Map(),
    mistakes: new Map(),
    usage: new Map(),
    reviewItems: new Map(),
    reviewLogs: [],
  };
}

/**
 * 内存存储：未配置 DATABASE_URL 时使用，让本地开发与自动化测试无需外部依赖即可跑通。
 * 挂在 globalThis 上，避免 Next.js 开发模式热重载导致数据丢失。
 */
export class MemoryStore implements Store {
  private state: MemoryState;
  private readonly key: string;

  constructor(key = "default") {
    this.key = key;
    const globalScope = globalThis as typeof globalThis & {
      __jevExamMemoryStores?: Map<string, MemoryState>;
    };
    globalScope.__jevExamMemoryStores ??= new Map();
    let state = globalScope.__jevExamMemoryStores.get(key);
    if (!state) {
      state = emptyState();
      globalScope.__jevExamMemoryStores.set(key, state);
    }
    this.state = state;
  }

  async reset(): Promise<void> {
    this.state = emptyState();
  }

  async createUser(email: string): Promise<UserRecord> {
    const normalized = normalizeEmail(email);
    const existing = await this.getUserByEmail(normalized);
    if (existing) return existing;
    const user: UserRecord = {
      id: createId("usr"),
      email: normalized,
      byokEncrypted: null,
      createdAt: new Date(),
    };
    this.state.users.set(user.id, user);
    return user;
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.state.users.get(id) ?? null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = normalizeEmail(email);
    for (const user of this.state.users.values()) {
      if (user.email === normalized) return user;
    }
    return null;
  }

  async setUserByok(userId: string, encrypted: string | null): Promise<void> {
    const user = this.state.users.get(userId);
    if (!user) throw new Error("用户不存在");
    this.state.users.set(userId, { ...user, byokEncrypted: encrypted });
  }

  async upsertInviteCode(
    code: string,
    maxUses: number,
    expiresAt: Date | null = null,
  ): Promise<InviteCodeRecord> {
    const normalized = code.trim().toUpperCase();
    const existing = this.state.inviteCodes.get(normalized);
    if (existing) return existing;
    const record: InviteCodeRecord = {
      code: normalized,
      maxUses,
      usedCount: 0,
      expiresAt,
      createdAt: new Date(),
    };
    this.state.inviteCodes.set(normalized, record);
    return record;
  }

  async getInviteCode(code: string): Promise<InviteCodeRecord | null> {
    return this.state.inviteCodes.get(code.trim().toUpperCase()) ?? null;
  }

  async consumeInviteCode(code: string): Promise<boolean> {
    const normalized = code.trim().toUpperCase();
    const record = this.state.inviteCodes.get(normalized);
    if (!record) return false;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return false;
    if (record.usedCount >= record.maxUses) return false;
    this.state.inviteCodes.set(normalized, { ...record, usedCount: record.usedCount + 1 });
    return true;
  }

  async createMaterial(input: NewMaterial): Promise<MaterialRecord> {
    const record: MaterialRecord = {
      ...input,
      sourceMap: input.sourceMap ?? null,
      id: createId("mat"),
      createdAt: new Date(),
    };
    this.state.materials.set(record.id, record);
    return record;
  }

  async getMaterial(id: string): Promise<MaterialRecord | null> {
    return this.state.materials.get(id) ?? null;
  }

  async listMaterials(userId: string): Promise<MaterialRecord[]> {
    return [...this.state.materials.values()]
      .filter((material) => material.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteMaterial(id: string, userId: string): Promise<boolean> {
    const material = this.state.materials.get(id);
    if (!material || material.userId !== userId) return false;
    this.state.materials.delete(id);

    const questionIds = new Set(
      [...this.state.questions.values()]
        .filter((question) => question.materialId === id)
        .map((question) => question.id),
    );
    for (const questionId of questionIds) this.state.questions.delete(questionId);

    for (const blueprint of [...this.state.blueprints.values()]) {
      if (blueprint.materialId === id) this.state.blueprints.delete(blueprint.id);
    }

    const examIds = new Set(
      [...this.state.exams.values()]
        .filter((exam) => exam.materialId === id)
        .map((exam) => exam.id),
    );
    for (const examId of examIds) {
      this.state.exams.delete(examId);
      this.state.examQuestions.delete(examId);
    }

    for (const attempt of [...this.state.attempts.values()]) {
      if (!examIds.has(attempt.examId)) continue;
      this.state.attempts.delete(attempt.id);
      for (const answer of [...this.state.answers.values()]) {
        if (answer.attemptId === attempt.id) {
          this.state.answers.delete(answer.id);
          this.state.judgments.delete(answer.id);
        }
      }
    }

    // mistakes 以 `${userId}::${questionId}` 为键，必须按 key 删除。
    for (const [key, mistake] of [...this.state.mistakes.entries()]) {
      if (mistake.materialId === id) this.state.mistakes.delete(key);
    }
    return true;
  }

  async saveBlueprint(input: NewBlueprint): Promise<BlueprintRecord> {
    const existing = await this.getBlueprintByMaterial(input.materialId);
    const record: BlueprintRecord = {
      id: existing?.id ?? createId("bp"),
      materialId: input.materialId,
      version: existing ? existing.version + 1 : (input.version ?? 1),
      topics: input.topics,
      generatorModel: input.generatorModel,
      createdAt: new Date(),
    };
    this.state.blueprints.set(record.id, record);
    return record;
  }

  async getBlueprintById(id: string): Promise<BlueprintRecord | null> {
    return this.state.blueprints.get(id) ?? null;
  }

  async getBlueprintByMaterial(materialId: string): Promise<BlueprintRecord | null> {
    for (const blueprint of this.state.blueprints.values()) {
      if (blueprint.materialId === materialId) return blueprint;
    }
    return null;
  }

  async createQuestions(inputs: NewQuestion[]): Promise<QuestionRecord[]> {
    const created = inputs.map((input) => ({ ...input, createdAt: new Date() }));
    for (const record of created) this.state.questions.set(record.id, record);
    return created;
  }

  async getQuestion(id: string): Promise<QuestionRecord | null> {
    return this.state.questions.get(id) ?? null;
  }

  async getQuestions(ids: string[]): Promise<QuestionRecord[]> {
    return ids.map((id) => this.state.questions.get(id)).filter((q): q is QuestionRecord => Boolean(q));
  }

  async listQuestionsByMaterial(materialId: string): Promise<QuestionRecord[]> {
    return [...this.state.questions.values()].filter(
      (question) => question.materialId === materialId,
    );
  }

  async createExam(
    input: NewExam,
    questions: { questionId: string; position: number }[],
  ): Promise<ExamRecord> {
    const record: ExamRecord = { ...input, id: createId("exam"), createdAt: new Date() };
    this.state.exams.set(record.id, record);
    this.state.examQuestions.set(record.id, [...questions]);
    return record;
  }

  async getExam(id: string): Promise<ExamRecord | null> {
    return this.state.exams.get(id) ?? null;
  }

  async listExams(userId: string): Promise<ExamRecord[]> {
    return [...this.state.exams.values()]
      .filter((exam) => exam.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listExamQuestionIds(examId: string): Promise<string[]> {
    return [...(this.state.examQuestions.get(examId) ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.questionId);
  }

  async createAttempt(examId: string, userId: string): Promise<AttemptRecord> {
    const record: AttemptRecord = {
      id: createId("att"),
      examId,
      userId,
      status: "in_progress",
      startedAt: new Date(),
      submittedAt: null,
      scorePercent: null,
      needsReviewCount: null,
    };
    this.state.attempts.set(record.id, record);
    return record;
  }

  async getAttempt(id: string): Promise<AttemptRecord | null> {
    return this.state.attempts.get(id) ?? null;
  }

  async getOpenAttempt(examId: string, userId: string): Promise<AttemptRecord | null> {
    for (const attempt of this.state.attempts.values()) {
      if (attempt.examId === examId && attempt.userId === userId && attempt.status === "in_progress") {
        return attempt;
      }
    }
    return null;
  }

  async listAttemptsByUser(userId: string): Promise<AttemptRecord[]> {
    return [...this.state.attempts.values()]
      .filter((attempt) => attempt.userId === userId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async saveAnswer(
    attemptId: string,
    questionId: string,
    payload: AnswerPayload | null,
  ): Promise<AnswerRecord> {
    const existing = [...this.state.answers.values()].find(
      (answer) => answer.attemptId === attemptId && answer.questionId === questionId,
    );
    const record: AnswerRecord = existing
      ? { ...existing, payload, updatedAt: new Date() }
      : {
          id: createId("ans"),
          attemptId,
          questionId,
          payload,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
    this.state.answers.set(record.id, record);
    return record;
  }

  async listAnswers(attemptId: string): Promise<AnswerRecord[]> {
    return [...this.state.answers.values()].filter((answer) => answer.attemptId === attemptId);
  }

  async submitAttempt(
    id: string,
    summary: { scorePercent: number; needsReviewCount: number; submittedAt: Date },
  ): Promise<void> {
    const attempt = this.state.attempts.get(id);
    if (!attempt) throw new Error("答题记录不存在");
    this.state.attempts.set(id, {
      ...attempt,
      status: "submitted",
      submittedAt: summary.submittedAt,
      scorePercent: summary.scorePercent,
      needsReviewCount: summary.needsReviewCount,
    });
  }

  async saveJudgment(input: NewJudgment): Promise<JudgmentRecord> {
    const existing = await this.getJudgmentByAnswer(input.answerId);
    const record: JudgmentRecord = {
      ...input,
      id: existing?.id ?? createId("jdg"),
      createdAt: existing?.createdAt ?? new Date(),
    };
    this.state.judgments.set(record.answerId, record);
    return record;
  }

  async getJudgmentByAnswer(answerId: string): Promise<JudgmentRecord | null> {
    return this.state.judgments.get(answerId) ?? null;
  }

  async listJudgmentsByAttempt(attemptId: string): Promise<JudgmentRecord[]> {
    return [...this.state.judgments.values()].filter(
      (judgment) => judgment.attemptId === attemptId,
    );
  }

  async applyMastery(
    userId: string,
    topicKey: string,
    topicTitle: string,
    score: number,
  ): Promise<MasteryRecord> {
    const key = `${userId}::${topicKey}`;
    const existing = this.state.mastery.get(key);
    const value = existing ? existing.value * (1 - MASTERY_ALPHA) + score * MASTERY_ALPHA : score;
    const record: MasteryRecord = {
      userId,
      topicKey,
      topicTitle,
      value,
      sampleCount: (existing?.sampleCount ?? 0) + 1,
      updatedAt: new Date(),
    };
    this.state.mastery.set(key, record);
    return record;
  }

  async listMastery(userId: string): Promise<MasteryRecord[]> {
    return [...this.state.mastery.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => a.value - b.value);
  }

  async upsertMistake(input: NewMistake): Promise<MistakeRecord> {
    const key = `${input.userId}::${input.questionId}`;
    const existing = this.state.mistakes.get(key);
    const record: MistakeRecord = {
      id: existing?.id ?? createId("mis"),
      userId: input.userId,
      questionId: input.questionId,
      materialId: input.materialId,
      topicKey: input.topicKey,
      topicTitle: input.topicTitle,
      lastScorePercent: input.lastScorePercent,
      wrongCount: (existing?.wrongCount ?? 0) + (input.increment === false ? 0 : 1),
      lastAttemptId: input.lastAttemptId,
      updatedAt: new Date(),
    };
    this.state.mistakes.set(key, record);
    return record;
  }

  async listMistakes(userId: string): Promise<MistakeRecord[]> {
    return [...this.state.mistakes.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async deleteMistake(userId: string, questionId: string): Promise<boolean> {
    return this.state.mistakes.delete(`${userId}::${questionId}`);
  }

  async incrementUsage(
    userId: string,
    day: string,
    kind: QuotaKind,
    amount: number,
  ): Promise<number> {
    const key = `${userId}::${day}::${kind}`;
    const next = (this.state.usage.get(key) ?? 0) + amount;
    this.state.usage.set(key, next);
    return next;
  }

  async getUsage(userId: string, day: string): Promise<UsageSnapshot> {
    const snapshot = {} as UsageSnapshot;
    for (const kind of Object.keys(QUOTA_LIMITS) as QuotaKind[]) {
      snapshot[kind] = this.state.usage.get(`${userId}::${day}::${kind}`) ?? 0;
    }
    return snapshot;
  }

  async upsertReviewItem(input: NewReviewItem): Promise<ReviewItemRecord> {
    const key = `${input.userId}::${input.questionId}`;
    const existing = this.state.reviewItems.get(key);
    const record: ReviewItemRecord = {
      ...input,
      id: existing?.id ?? createId("rev"),
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.state.reviewItems.set(key, record);
    return record;
  }

  async getReviewItem(userId: string, questionId: string): Promise<ReviewItemRecord | null> {
    return this.state.reviewItems.get(`${userId}::${questionId}`) ?? null;
  }

  async listReviewItems(userId: string): Promise<ReviewItemRecord[]> {
    return [...this.state.reviewItems.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  }

  async listDueReviewItems(userId: string, dueBefore: Date, limit: number): Promise<ReviewItemRecord[]> {
    return (await this.listReviewItems(userId))
      .filter((item) => item.dueAt.getTime() <= dueBefore.getTime())
      .slice(0, limit);
  }

  async deleteReviewItem(userId: string, questionId: string): Promise<boolean> {
    return this.state.reviewItems.delete(`${userId}::${questionId}`);
  }

  async saveReviewLog(input: NewReviewLog): Promise<ReviewLogRecord> {
    const record: ReviewLogRecord = {
      ...input,
      id: createId("rlg"),
      reviewedAt: input.reviewedAt ?? new Date(),
    };
    this.state.reviewLogs.push(record);
    return record;
  }
}
