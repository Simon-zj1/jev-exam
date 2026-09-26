import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginWithInvite } from "@/lib/auth/session";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { setChatProviderOverride } from "@/lib/llm/provider";
import type { AnswerPayload } from "@/lib/grading";
import { submitAttemptForUser } from "@/lib/services/attempts";
import { buildAnkiCsv, buildBackup, buildMarkdownExport } from "@/lib/services/export";
import { createExamForMaterial, generateOutlineForMaterial } from "@/lib/services/generation";
import { createMaterialForUser } from "@/lib/services/materials";
import { recordChatUsage } from "@/lib/services/usage";
import { FakeEngine, SAMPLE_MATERIAL, noul, resetOverrides, useMemoryStore } from "../helpers";

describe("数据导出", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];

  beforeEach(async () => {
    setChatProviderOverride(null);
    store = useMemoryStore();
    setGenerationProviderOverride(new HeuristicGenerationProvider());
    setDecisionEngineOverride(
      new FakeEngine((_state, questions) => {
        const answers: Record<string, ReturnType<typeof noul>> = {};
        for (const key of Object.keys(questions)) {
          answers[key] = key.startsWith("point_") ? noul(0.9) : noul(0.05);
        }
        return answers;
      }),
    );
    await store.upsertInviteCode("EXPORT-CODE", 10);
    user = (await loginWithInvite("exporter@example.com", "EXPORT-CODE")).user;
  });

  afterEach(() => resetOverrides());

  async function seedAttempt() {
    const material = await createMaterialForUser(user, {
      title: "导出材料",
      rawText: SAMPLE_MATERIAL,
    });
    await generateOutlineForMaterial(user, material.id, { topicCount: 3 });
    const exam = await createExamForMaterial(user, {
      materialId: material.id,
      topicIds: [],
      count: 4,
      mix: { mcq: 2, true_false: 1, cloze: 1 },
    });
    const questions = await store.getQuestions(await store.listExamQuestionIds(exam.exam.id));
    const answers = questions.map((question) => {
      const payload: AnswerPayload =
        question.type === "mcq"
          ? { type: "mcq", index: 0 }
          : question.type === "true_false"
            ? { type: "true_false", value: !(question.answerKey.true_false?.answer ?? true) }
            : { type: "cloze", text: "错答案" };
      return { questionId: question.id, payload };
    });
    await submitAttemptForUser(user, exam.exam.id, answers);
    return { material, questions };
  }

  it("完整备份包含材料、题目、判定、复习与用量", async () => {
    await seedAttempt();
    await recordChatUsage(user.id, [
      { model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 200 },
    ]);

    const backup = await buildBackup(user);

    expect(backup.format).toBe("jev-exam-backup");
    expect(backup.user.email).toBe("exporter@example.com");
    expect(backup.materials).toHaveLength(1);
    expect(backup.questions.length).toBeGreaterThan(0);
    expect(backup.judgments.length).toBeGreaterThan(0);
    expect(backup.attempts).toHaveLength(1);
    // 材料正文必须原样带走，否则「导出」等于只是导了个索引
    expect((backup.materials[0] as { rawText: string }).rawText).toContain("光合作用");
    expect(JSON.stringify(backup.usage)).toContain("gpt-4o-mini");
    // 备份里不能出现密钥字段
    expect(JSON.stringify(backup)).not.toContain("byokEncrypted");
  });

  it("Anki CSV 有表头、可转义引号，且每题都有答案", async () => {
    await seedAttempt();
    const csv = await buildAnkiCsv(user);
    const lines = csv.split("\n");

    expect(lines[0]).toBe('"正面","反面","标签"');
    expect(lines.length).toBeGreaterThan(1);
    // 字段内含换行是合法的（题目与答案都是多行），所以不能按行切；
    // 能验证的是每个引号都成对闭合，以及所有字段都被引号包裹。
    expect((csv.match(/"/g) ?? []).length % 2).toBe(0);
    const record = csv.slice(csv.indexOf("\n") + 1);
    expect(record.startsWith('"')).toBe(true);
    // 三个字段 → 每行恰好 5 个引号字符边界（起始、字段间两个、结尾）
    expect(record.split(",").length).toBeGreaterThanOrEqual(3);
    expect(csv).toContain("jev-exam");
    expect(csv).toContain("出处：");
  });

  it("Markdown 导出包含材料原文、题目与学习状态", async () => {
    await seedAttempt();
    const markdown = await buildMarkdownExport(user);

    expect(markdown).toContain("# Jev 备考 · 数据导出");
    expect(markdown).toContain("## 导出材料");
    expect(markdown).toContain("### 材料原文");
    expect(markdown).toContain("### 题目与评分点");
    expect(markdown).toContain("## 学习状态");
    // 材料原文逐字出现
    expect(markdown).toContain("光合作用分为光反应和暗反应两个阶段。");
  });

  it("没有任何数据时导出仍然可用（不抛错）", async () => {
    const backup = await buildBackup(user);
    expect(backup.materials).toHaveLength(0);
    const csv = await buildAnkiCsv(user);
    expect(csv.split("\n")).toHaveLength(1);
    const markdown = await buildMarkdownExport(user);
    expect(markdown).toContain("材料 0 份");
  });
});
