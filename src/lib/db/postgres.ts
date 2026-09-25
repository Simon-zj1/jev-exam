import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { QUOTA_LIMITS, type QuotaKind } from "@/lib/config";
import { createId } from "@/lib/ids";
import { normalizeEmail } from "@/lib/auth/email";
import * as schema from "@/lib/db/schema";
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
import type { AnswerPayload } from "@/lib/grading";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyPgDatabase = PgDatabase<any, any, any>;

const MASTERY_ALPHA = 0.3;

/**
 * Postgres（Drizzle）实现。通过 PgDatabase 泛型同时兼容 node-postgres 与 PGlite，
 * 后者让数据库层可以在测试里真实执行。
 */
export class PostgresStore implements Store {
  private readonly db: AnyPgDatabase;

  constructor(db: AnyPgDatabase) {
    this.db = db;
  }

  async reset(): Promise<void> {
    await this.db.delete(schema.reviewLogs);
    await this.db.delete(schema.reviewItems);
    await this.db.delete(schema.usageCounters);
    await this.db.delete(schema.mistakeItems);
    await this.db.delete(schema.mastery);
    await this.db.delete(schema.judgments);
    await this.db.delete(schema.answers);
    await this.db.delete(schema.attempts);
    await this.db.delete(schema.examQuestions);
    await this.db.delete(schema.exams);
    await this.db.delete(schema.questions);
    await this.db.delete(schema.examBlueprints);
    await this.db.delete(schema.materials);
    await this.db.delete(schema.inviteCodes);
    await this.db.delete(schema.users);
  }

  async createUser(email: string): Promise<UserRecord> {
    const normalized = normalizeEmail(email);
    const existing = await this.getUserByEmail(normalized);
    if (existing) return existing;
    const rows = await this.db
      .insert(schema.users)
      .values({ id: createId("usr"), email: normalized })
      .onConflictDoNothing({ target: schema.users.email })
      .returning();
    if (rows[0]) return rows[0] as UserRecord;
    const created = await this.getUserByEmail(normalized);
    if (!created) throw new Error("创建用户失败");
    return created;
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return (rows[0] as UserRecord | undefined) ?? null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizeEmail(email)))
      .limit(1);
    return (rows[0] as UserRecord | undefined) ?? null;
  }

  async setUserByok(userId: string, encrypted: string | null): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ byokEncrypted: encrypted })
      .where(eq(schema.users.id, userId));
  }

  async upsertInviteCode(
    code: string,
    maxUses: number,
    expiresAt: Date | null = null,
  ): Promise<InviteCodeRecord> {
    const normalized = code.trim().toUpperCase();
    const existing = await this.getInviteCode(normalized);
    if (existing) return existing;
    const rows = await this.db
      .insert(schema.inviteCodes)
      .values({ code: normalized, maxUses, expiresAt })
      .onConflictDoNothing({ target: schema.inviteCodes.code })
      .returning();
    if (rows[0]) return rows[0] as InviteCodeRecord;
    const created = await this.getInviteCode(normalized);
    if (!created) throw new Error("创建邀请码失败");
    return created;
  }

  async getInviteCode(code: string): Promise<InviteCodeRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, code.trim().toUpperCase()))
      .limit(1);
    return (rows[0] as InviteCodeRecord | undefined) ?? null;
  }

  async consumeInviteCode(code: string): Promise<boolean> {
    const rows = await this.db
      .update(schema.inviteCodes)
      .set({ usedCount: sql`${schema.inviteCodes.usedCount} + 1` })
      .where(
        and(
          eq(schema.inviteCodes.code, code.trim().toUpperCase()),
          lt(schema.inviteCodes.usedCount, schema.inviteCodes.maxUses),
          or(
            isNull(schema.inviteCodes.expiresAt),
            gt(schema.inviteCodes.expiresAt, new Date()),
          ),
        ),
      )
      .returning({ code: schema.inviteCodes.code });
    return rows.length > 0;
  }

  async createMaterial(input: NewMaterial): Promise<MaterialRecord> {
    const rows = await this.db
      .insert(schema.materials)
      .values({ ...input, id: createId("mat") })
      .returning();
    return rows[0] as MaterialRecord;
  }

  async getMaterial(id: string): Promise<MaterialRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.id, id))
      .limit(1);
    return (rows[0] as MaterialRecord | undefined) ?? null;
  }

  async listMaterials(userId: string): Promise<MaterialRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.userId, userId))
      .orderBy(desc(schema.materials.createdAt));
    return rows as MaterialRecord[];
  }

  async deleteMaterial(id: string, userId: string): Promise<boolean> {
    const material = await this.getMaterial(id);
    if (!material || material.userId !== userId) return false;

    const examIds = this.db
      .select({ id: schema.exams.id })
      .from(schema.exams)
      .where(eq(schema.exams.materialId, id));
    const attemptIds = this.db
      .select({ id: schema.attempts.id })
      .from(schema.attempts)
      .where(inArray(schema.attempts.examId, examIds));

    await this.db.delete(schema.judgments).where(inArray(schema.judgments.attemptId, attemptIds));
    await this.db.delete(schema.answers).where(inArray(schema.answers.attemptId, attemptIds));
    await this.db.delete(schema.attempts).where(inArray(schema.attempts.examId, examIds));
    await this.db.delete(schema.examQuestions).where(inArray(schema.examQuestions.examId, examIds));
    await this.db.delete(schema.exams).where(eq(schema.exams.materialId, id));
    await this.db.delete(schema.questions).where(eq(schema.questions.materialId, id));
    await this.db.delete(schema.examBlueprints).where(eq(schema.examBlueprints.materialId, id));
    await this.db.delete(schema.mistakeItems).where(eq(schema.mistakeItems.materialId, id));
    await this.db.delete(schema.materials).where(eq(schema.materials.id, id));
    return true;
  }

  async saveBlueprint(input: NewBlueprint): Promise<BlueprintRecord> {
    const existing = await this.getBlueprintByMaterial(input.materialId);
    if (existing) {
      const rows = await this.db
        .update(schema.examBlueprints)
        .set({
          topics: input.topics,
          generatorModel: input.generatorModel,
          version: existing.version + 1,
          createdAt: new Date(),
        })
        .where(eq(schema.examBlueprints.id, existing.id))
        .returning();
      return rows[0] as BlueprintRecord;
    }
    const rows = await this.db
      .insert(schema.examBlueprints)
      .values({
        id: createId("bp"),
        materialId: input.materialId,
        version: input.version ?? 1,
        topics: input.topics,
        generatorModel: input.generatorModel,
      })
      .returning();
    return rows[0] as BlueprintRecord;
  }

  async getBlueprintById(id: string): Promise<BlueprintRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.examBlueprints)
      .where(eq(schema.examBlueprints.id, id))
      .limit(1);
    return (rows[0] as BlueprintRecord | undefined) ?? null;
  }

  async getBlueprintByMaterial(materialId: string): Promise<BlueprintRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.examBlueprints)
      .where(eq(schema.examBlueprints.materialId, materialId))
      .limit(1);
    return (rows[0] as BlueprintRecord | undefined) ?? null;
  }

  async createQuestions(inputs: NewQuestion[]): Promise<QuestionRecord[]> {
    if (inputs.length === 0) return [];
    const rows = await this.db.insert(schema.questions).values(inputs).returning();
    return rows as QuestionRecord[];
  }

  async getQuestion(id: string): Promise<QuestionRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.questions)
      .where(eq(schema.questions.id, id))
      .limit(1);
    return (rows[0] as QuestionRecord | undefined) ?? null;
  }

  async getQuestions(ids: string[]): Promise<QuestionRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.questions)
      .where(inArray(schema.questions.id, ids));
    return rows as QuestionRecord[];
  }

  async listQuestionsByMaterial(materialId: string): Promise<QuestionRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.questions)
      .where(eq(schema.questions.materialId, materialId))
      .orderBy(asc(schema.questions.createdAt));
    return rows as QuestionRecord[];
  }

  async createExam(
    input: NewExam,
    questions: { questionId: string; position: number }[],
  ): Promise<ExamRecord> {
    const examId = createId("exam");
    const rows = await this.db
      .insert(schema.exams)
      .values({ ...input, id: examId })
      .returning();
    if (questions.length > 0) {
      await this.db
        .insert(schema.examQuestions)
        .values(questions.map((entry) => ({ ...entry, examId })));
    }
    return rows[0] as ExamRecord;
  }

  async getExam(id: string): Promise<ExamRecord | null> {
    const rows = await this.db.select().from(schema.exams).where(eq(schema.exams.id, id)).limit(1);
    return (rows[0] as ExamRecord | undefined) ?? null;
  }

  async listExams(userId: string): Promise<ExamRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.userId, userId))
      .orderBy(desc(schema.exams.createdAt));
    return rows as ExamRecord[];
  }

  async listExamQuestionIds(examId: string): Promise<string[]> {
    const rows = await this.db
      .select({ questionId: schema.examQuestions.questionId })
      .from(schema.examQuestions)
      .where(eq(schema.examQuestions.examId, examId))
      .orderBy(asc(schema.examQuestions.position));
    return rows.map((row) => row.questionId);
  }

  async createAttempt(examId: string, userId: string): Promise<AttemptRecord> {
    const rows = await this.db
      .insert(schema.attempts)
      .values({ id: createId("att"), examId, userId, status: "in_progress" })
      .returning();
    return rows[0] as AttemptRecord;
  }

  async getAttempt(id: string): Promise<AttemptRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.id, id))
      .limit(1);
    return (rows[0] as AttemptRecord | undefined) ?? null;
  }

  async getOpenAttempt(examId: string, userId: string): Promise<AttemptRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.attempts)
      .where(
        and(
          eq(schema.attempts.examId, examId),
          eq(schema.attempts.userId, userId),
          eq(schema.attempts.status, "in_progress"),
        ),
      )
      .orderBy(desc(schema.attempts.startedAt))
      .limit(1);
    return (rows[0] as AttemptRecord | undefined) ?? null;
  }

  async listAttemptsByUser(userId: string): Promise<AttemptRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.userId, userId))
      .orderBy(desc(schema.attempts.startedAt));
    return rows as AttemptRecord[];
  }

  async saveAnswer(
    attemptId: string,
    questionId: string,
    payload: AnswerPayload | null,
  ): Promise<AnswerRecord> {
    const rows = await this.db
      .insert(schema.answers)
      .values({ id: createId("ans"), attemptId, questionId, payload })
      .onConflictDoUpdate({
        target: [schema.answers.attemptId, schema.answers.questionId],
        set: { payload, updatedAt: new Date() },
      })
      .returning();
    return rows[0] as AnswerRecord;
  }

  async listAnswers(attemptId: string): Promise<AnswerRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.answers)
      .where(eq(schema.answers.attemptId, attemptId));
    return rows as AnswerRecord[];
  }

  async submitAttempt(
    id: string,
    summary: { scorePercent: number; needsReviewCount: number; submittedAt: Date },
  ): Promise<void> {
    await this.db
      .update(schema.attempts)
      .set({
        status: "submitted",
        submittedAt: summary.submittedAt,
        scorePercent: summary.scorePercent,
        needsReviewCount: summary.needsReviewCount,
      })
      .where(eq(schema.attempts.id, id));
  }

  async saveJudgment(input: NewJudgment): Promise<JudgmentRecord> {
    const rows = await this.db
      .insert(schema.judgments)
      .values({ ...input, id: createId("jdg") })
      .onConflictDoUpdate({
        target: schema.judgments.answerId,
        set: {
          method: input.method,
          score: input.score,
          scorePercent: input.scorePercent,
          confidence: input.confidence,
          needsReview: input.needsReview,
          reviewReasons: input.reviewReasons,
          points: input.points,
          penalties: input.penalties,
          scoreLow: input.scoreLow,
          scoreHigh: input.scoreHigh,
          engineId: input.engineId,
          model: input.model,
          latencyMs: input.latencyMs,
          request: input.request,
          response: input.response,
        },
      })
      .returning();
    return rows[0] as JudgmentRecord;
  }

  async getJudgmentByAnswer(answerId: string): Promise<JudgmentRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.judgments)
      .where(eq(schema.judgments.answerId, answerId))
      .limit(1);
    return (rows[0] as JudgmentRecord | undefined) ?? null;
  }

  async listJudgmentsByAttempt(attemptId: string): Promise<JudgmentRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.judgments)
      .where(eq(schema.judgments.attemptId, attemptId));
    return rows as JudgmentRecord[];
  }

  async applyMastery(
    userId: string,
    topicKey: string,
    topicTitle: string,
    score: number,
  ): Promise<MasteryRecord> {
    const existing = await this.db
      .select()
      .from(schema.mastery)
      .where(and(eq(schema.mastery.userId, userId), eq(schema.mastery.topicKey, topicKey)))
      .limit(1);
    const previous = existing[0] as MasteryRecord | undefined;
    const value = previous
      ? previous.value * (1 - MASTERY_ALPHA) + score * MASTERY_ALPHA
      : score;
    const rows = await this.db
      .insert(schema.mastery)
      .values({
        userId,
        topicKey,
        topicTitle,
        value,
        sampleCount: (previous?.sampleCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.mastery.userId, schema.mastery.topicKey],
        set: {
          value,
          topicTitle,
          sampleCount: (previous?.sampleCount ?? 0) + 1,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0] as MasteryRecord;
  }

  async listMastery(userId: string): Promise<MasteryRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.mastery)
      .where(eq(schema.mastery.userId, userId))
      .orderBy(asc(schema.mastery.value));
    return rows as MasteryRecord[];
  }

  async upsertMistake(input: NewMistake): Promise<MistakeRecord> {
    const existing = await this.db
      .select()
      .from(schema.mistakeItems)
      .where(
        and(
          eq(schema.mistakeItems.userId, input.userId),
          eq(schema.mistakeItems.questionId, input.questionId),
        ),
      )
      .limit(1);
    const previous = existing[0] as MistakeRecord | undefined;
    const wrongCount = (previous?.wrongCount ?? 0) + (input.increment === false ? 0 : 1);
    const rows = await this.db
      .insert(schema.mistakeItems)
      .values({
        id: createId("mis"),
        userId: input.userId,
        questionId: input.questionId,
        materialId: input.materialId,
        topicKey: input.topicKey,
        topicTitle: input.topicTitle,
        lastScorePercent: input.lastScorePercent,
        wrongCount,
        lastAttemptId: input.lastAttemptId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.mistakeItems.userId, schema.mistakeItems.questionId],
        set: {
          materialId: input.materialId,
          topicKey: input.topicKey,
          topicTitle: input.topicTitle,
          lastScorePercent: input.lastScorePercent,
          wrongCount,
          lastAttemptId: input.lastAttemptId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0] as MistakeRecord;
  }

  async listMistakes(userId: string): Promise<MistakeRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.mistakeItems)
      .where(eq(schema.mistakeItems.userId, userId))
      .orderBy(desc(schema.mistakeItems.updatedAt));
    return rows as MistakeRecord[];
  }

  async deleteMistake(userId: string, questionId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.mistakeItems)
      .where(
        and(
          eq(schema.mistakeItems.userId, userId),
          eq(schema.mistakeItems.questionId, questionId),
        ),
      )
      .returning({ id: schema.mistakeItems.id });
    return rows.length > 0;
  }

  async incrementUsage(
    userId: string,
    day: string,
    kind: QuotaKind,
    amount: number,
  ): Promise<number> {
    const rows = await this.db
      .insert(schema.usageCounters)
      .values({ userId, day, kind, amount })
      .onConflictDoUpdate({
        target: [schema.usageCounters.userId, schema.usageCounters.day, schema.usageCounters.kind],
        set: { amount: sql`${schema.usageCounters.amount} + ${amount}` },
      })
      .returning({ amount: schema.usageCounters.amount });
    return rows[0]?.amount ?? amount;
  }

  async getUsage(userId: string, day: string): Promise<UsageSnapshot> {
    const rows = await this.db
      .select()
      .from(schema.usageCounters)
      .where(and(eq(schema.usageCounters.userId, userId), eq(schema.usageCounters.day, day)));
    const snapshot: UsageSnapshot = { material: 0, question: 0, judgment: 0 };
    for (const row of rows as { kind: string; amount: number }[]) {
      if ((Object.keys(QUOTA_LIMITS) as string[]).includes(row.kind)) {
        snapshot[row.kind as QuotaKind] = row.amount;
      }
    }
    return snapshot;
  }

  async upsertReviewItem(input: NewReviewItem): Promise<ReviewItemRecord> {
    const rows = await this.db
      .insert(schema.reviewItems)
      .values({ ...input, id: createId("rev") })
      .onConflictDoUpdate({
        target: [schema.reviewItems.userId, schema.reviewItems.questionId],
        set: {
          stability: input.stability,
          difficulty: input.difficulty,
          reps: input.reps,
          lapses: input.lapses,
          state: input.state,
          dueAt: input.dueAt,
          lastReviewedAt: input.lastReviewedAt,
          lastScorePercent: input.lastScorePercent,
          lastRating: input.lastRating,
          topicKey: input.topicKey,
          topicTitle: input.topicTitle,
          materialId: input.materialId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0] as ReviewItemRecord;
  }

  async getReviewItem(userId: string, questionId: string): Promise<ReviewItemRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.reviewItems)
      .where(
        and(eq(schema.reviewItems.userId, userId), eq(schema.reviewItems.questionId, questionId)),
      )
      .limit(1);
    return (rows[0] as ReviewItemRecord | undefined) ?? null;
  }

  async listReviewItems(userId: string): Promise<ReviewItemRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.reviewItems)
      .where(eq(schema.reviewItems.userId, userId))
      .orderBy(asc(schema.reviewItems.dueAt));
    return rows as ReviewItemRecord[];
  }

  async listDueReviewItems(
    userId: string,
    dueBefore: Date,
    limit: number,
  ): Promise<ReviewItemRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.reviewItems)
      .where(
        and(eq(schema.reviewItems.userId, userId), lte(schema.reviewItems.dueAt, dueBefore)),
      )
      .orderBy(asc(schema.reviewItems.dueAt))
      .limit(limit);
    return rows as ReviewItemRecord[];
  }

  async deleteReviewItem(userId: string, questionId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.reviewItems)
      .where(
        and(eq(schema.reviewItems.userId, userId), eq(schema.reviewItems.questionId, questionId)),
      )
      .returning({ id: schema.reviewItems.id });
    return rows.length > 0;
  }

  async saveReviewLog(input: NewReviewLog): Promise<ReviewLogRecord> {
    const rows = await this.db
      .insert(schema.reviewLogs)
      .values({ ...input, id: createId("rlg") })
      .returning();
    return rows[0] as ReviewLogRecord;
  }
}
