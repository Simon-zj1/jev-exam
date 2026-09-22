import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_MATERIAL } from "../helpers";

/**
 * Postgres（Drizzle）数据层的真实执行验证。
 *
 * 使用 PGlite（进程内 Postgres）跑真实 SQL 与真实迁移文件，验证 schema 与查询。
 * 未安装 @electric-sql/pglite 时整组跳过（CI 里建议装上，成本只有一个 wasm 包）。
 */
let pgliteAvailable = false;
try {
  // 用变量 specifier：未安装该可选依赖时不影响类型检查与其余测试。
  const pgliteModule = "@electric-sql/pglite";
  await import(pgliteModule);
  pgliteAvailable = true;
} catch {
  pgliteAvailable = false;
}

describe.skipIf(!pgliteAvailable)("Postgres 存储层（PGlite 实测）", () => {
  let store!: {
    reset(): Promise<void>;
    createUser(email: string): Promise<{ id: string; email: string }>;
    getUserByEmail(email: string): Promise<{ id: string } | null>;
    setUserByok(userId: string, value: string | null): Promise<void>;
    upsertInviteCode(code: string, maxUses: number): Promise<unknown>;
    consumeInviteCode(code: string): Promise<boolean>;
    createMaterial(input: {
      userId: string;
      title: string;
      rawText: string;
      tokenCount: number;
      contentHash: string;
    }): Promise<{ id: string }>;
    saveBlueprint(input: {
      materialId: string;
      topics: { id: string; title: string; summary: string; source_spans: string[] }[];
      generatorModel: string;
    }): Promise<{ id: string; version: number }>;
    createQuestions(
      inputs: {
        id: string;
        materialId: string;
        blueprintId: string;
        topicId: string;
        topicTitle: string;
        type: string;
        stem: string;
        options: string[] | null;
        answerKey: Record<string, unknown>;
        rubricPoints: null;
        sourceAnchor: string;
        difficulty: string;
        explanation: string | null;
      }[],
    ): Promise<unknown[]>;
    createExam(
      input: {
        userId: string;
        materialId: string;
        blueprintId: string;
        title: string;
        kind: "generated";
        config: { mix: Record<string, number>; count: number; topicIds: string[] };
        generatorModel: string;
      },
      questions: { questionId: string; position: number }[],
    ): Promise<{ id: string }>;
    listExamQuestionIds(examId: string): Promise<string[]>;
    createAttempt(examId: string, userId: string): Promise<{ id: string }>;
    saveAnswer(
      attemptId: string,
      questionId: string,
      payload: { type: "cloze"; text: string } | null,
    ): Promise<{ id: string }>;
    saveJudgment(input: Record<string, unknown>): Promise<{ id: string }>;
    incrementUsage(
      userId: string,
      day: string,
      kind: "material" | "question" | "judgment",
      amount: number,
    ): Promise<number>;
    getUsage(userId: string, day: string): Promise<Record<string, number>>;
    applyMastery(
      userId: string,
      topicKey: string,
      topicTitle: string,
      score: number,
    ): Promise<{ value: number; sampleCount: number }>;
    upsertMistake(input: Record<string, unknown>): Promise<{ wrongCount: number }>;
    deleteMistake(userId: string, questionId: string): Promise<boolean>;
    deleteMaterial(id: string, userId: string): Promise<boolean>;
  };
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const pgliteModule = "@electric-sql/pglite";
    const { PGlite } = (await import(pgliteModule)) as typeof import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { PostgresStore } = await import("@/lib/db/postgres");
    const schema = await import("@/lib/db/schema");

    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new PostgresStore(db as any) as unknown as typeof store;
    cleanup = async () => {
      await client.close();
    };
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it("用户 / 邀请码 / Byok", async () => {
    await store.reset();
    const user = await store.createUser("PgUser@Example.com");
    expect(user.email).toBe("pguser@example.com");

    const again = await store.createUser("pguser@example.com");
    expect(again.id).toBe(user.id);

    await store.setUserByok(user.id, "v1:abc");
    expect((await store.getUserByEmail("pguser@example.com"))?.id).toBe(user.id);

    await store.upsertInviteCode("pg-code", 1);
    expect(await store.consumeInviteCode("PG-CODE")).toBe(true);
    expect(await store.consumeInviteCode("PG-CODE")).toBe(false);
  });

  it("材料 → 大纲 → 题目 → 试卷 → 作答 → 判定 → 掌握度/错题 → 级联删除", async () => {
    await store.reset();
    const user = await store.createUser("pg-flow@example.com");
    const material = await store.createMaterial({
      userId: user.id,
      title: "光合作用",
      rawText: SAMPLE_MATERIAL,
      tokenCount: 120,
      contentHash: "hash-1",
    });
    const blueprint = await store.saveBlueprint({
      materialId: material.id,
      topics: [
        { id: "t1", title: "光反应", summary: "光反应", source_spans: ["光反应发生在类囊体薄膜上"] },
      ],
      generatorModel: "test-model",
    });

    await store.createQuestions([
      {
        id: "q1",
        materialId: material.id,
        blueprintId: blueprint.id,
        topicId: "t1",
        topicTitle: "光反应",
        type: "cloze",
        stem: "光反应发生在____上",
        options: null,
        answerKey: { cloze: { answer: "类囊体薄膜", accepted: ["类囊体薄膜"] } },
        rubricPoints: null,
        sourceAnchor: "光反应发生在类囊体薄膜上",
        difficulty: "easy",
        explanation: null,
      },
    ]);

    const exam = await store.createExam(
      {
        userId: user.id,
        materialId: material.id,
        blueprintId: blueprint.id,
        title: "试卷",
        kind: "generated",
        config: { mix: { cloze: 1 }, count: 1, topicIds: ["t1"] },
        generatorModel: "test-model",
      },
      [{ questionId: "q1", position: 0 }],
    );
    expect(await store.listExamQuestionIds(exam.id)).toEqual(["q1"]);

    const attempt = await store.createAttempt(exam.id, user.id);
    const answer = await store.saveAnswer(attempt.id, "q1", { type: "cloze", text: "类囊体薄膜" });
    await store.saveJudgment({
      answerId: answer.id,
      attemptId: attempt.id,
      questionId: "q1",
      userId: user.id,
      method: "exact",
      score: 1,
      scorePercent: 100,
      confidence: 1,
      needsReview: false,
      reviewReasons: [],
      points: [],
      penalties: [],
      scoreLow: null,
      scoreHigh: null,
      engineId: "deterministic",
      model: "deterministic",
      latencyMs: 0,
      request: null,
      response: null,
    });

    const mastery = await store.applyMastery(user.id, "光反应", "光反应", 1);
    expect(mastery.sampleCount).toBe(1);
    const second = await store.applyMastery(user.id, "光反应", "光反应", 0);
    expect(second.sampleCount).toBe(2);
    expect(second.value).toBeCloseTo(0.7, 5);

    const mistake = await store.upsertMistake({
      userId: user.id,
      questionId: "q1",
      materialId: material.id,
      topicKey: "光反应",
      topicTitle: "光反应",
      lastScorePercent: 0,
      lastAttemptId: attempt.id,
      increment: true,
    });
    expect(mistake.wrongCount).toBe(1);
    expect(await store.deleteMistake(user.id, "q1")).toBe(true);

    expect(await store.incrementUsage(user.id, "2026-09-23", "question", 3)).toBe(3);
    expect(await store.incrementUsage(user.id, "2026-09-23", "question", 2)).toBe(5);
    expect((await store.getUsage(user.id, "2026-09-23")).question).toBe(5);

    expect(await store.deleteMaterial(material.id, user.id)).toBe(true);
    expect(await store.listExamQuestionIds(exam.id)).toEqual([]);
  });
});
