#!/usr/bin/env tsx
/**
 * Jev 备考命令行工具（Agent Skill 的执行入口）。
 *
 * 设计分工和 SKILL.md 一致：
 * - 内容（出题、参考答案、得分点）由 Agent / LLM 产出，写进 exam.json；
 * - 本工具负责校验（schema、溯源契约、覆盖率）、判定（DecisionEngine）与渲染（离线静态报告）。
 *
 * 用法：
 *   tsx scripts/study.ts answer-template --exam exam.json --out answers.json
 *   tsx scripts/study.ts verify --material material.md --exam exam.json [--strict]
 *   tsx scripts/study.ts grade  --material material.md --exam exam.json --answers answers.json --out ./learning_work
 *   tsx scripts/study.ts render --report report.json --out report.html [--md report.md]
 *   tsx scripts/study.ts demo   --out docs/demo
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { verifyCoverage, coverageSummary } from "@/lib/coverage";
import { resolveDecisionEngine } from "@/lib/engine";
import { LexicalJudgeEngine } from "@/lib/engine/lexical";
import { LLMJudgeEngine } from "@/lib/engine/llm-judge";
import { TypeSafeEngine } from "@/lib/engine/typesafe";
import { resolvePlatformChatProvider } from "@/lib/llm/provider";
import { gradeQuestion, type AnswerPayload } from "@/lib/grading";
import { generatedQuestionSchema, topicSchema } from "@/lib/generator/schema";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { verifyProvenance, PROVENANCE_CONTRACT } from "@/lib/provenance";
import {
  buildStudyReport,
  renderReportHtml,
  renderReportMarkdown,
  type StudyReport,
} from "@/lib/report";
import { scanMaterial, summarizeHazards } from "@/lib/security/untrusted";
import type { DecisionEngine, GeneratedQuestion, Topic } from "@/lib/types";
import { z } from "zod";

const examFileSchema = z.object({
  version: z.number().optional(),
  title: z.string().default("未命名试卷"),
  generator: z.string().default("agent"),
  topics: z.array(topicSchema).default([]),
  questions: z.array(z.unknown()),
});

type ExamFile = {
  version?: number;
  title: string;
  generator: string;
  topics: Topic[];
  questions: GeneratedQuestion[];
};

const answerFileSchema = z.object({
  version: z.number().optional(),
  answers: z.array(
    z.object({
      questionId: z.string(),
      payload: z.unknown().nullable(),
    }),
  ),
});

type AnswerFile = z.infer<typeof answerFileSchema>;

type Parsed = Record<string, string | boolean | undefined>;

function parseArgs(argv: string[]): { command: string; flags: Parsed } {
  const [command = "help", ...rest] = argv;
  const flags: Parsed = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags };
}

async function readText(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

async function writeText(path: string, content: string): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadExam(path: string): Promise<ExamFile> {
  const raw = await readJson<unknown>(path);
  const parsed = examFileSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`试卷文件结构不合法：${parsed.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).join("; ")}`);
  }

  const questions: GeneratedQuestion[] = [];
  const problems: string[] = [];
  parsed.data.questions.forEach((candidate, index) => {
    const result = generatedQuestionSchema.safeParse(candidate);
    if (result.success) questions.push(result.data as GeneratedQuestion);
    else {
      problems.push(
        `第 ${index + 1} 题：${result.error.issues
          .slice(0, 2)
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }
  });
  if (problems.length > 0) fail(`试卷中有 ${problems.length} 道题不符合契约：\n- ${problems.join("\n- ")}`);
  if (questions.length === 0) fail("试卷里没有题目");

  return {
    version: parsed.data.version,
    title: parsed.data.title,
    generator: parsed.data.generator,
    topics: parsed.data.topics,
    questions,
  };
}

function pickEngine(flag: string | undefined, quiet = false): {
  engine: DecisionEngine;
  mode: string;
} {
  if (flag === "offline") {
    if (!quiet) warn("使用离线词面判定引擎（演示用，不能代表 Jev 的质量）");
    return { engine: new LexicalJudgeEngine(), mode: "offline" };
  }
  if (flag === "typesafe") {
    const engine = TypeSafeEngine.fromEnv();
    if (!engine) fail("--engine typesafe 需要设置 TYPESAFE_API_KEY");
    return { engine, mode: "typesafe" };
  }
  if (flag === "llm") {
    const provider = resolvePlatformChatProvider();
    if (!provider) fail("--engine llm 需要设置 PLATFORM_LLM_API_KEY（OpenAI 兼容接口）");
    return { engine: new LLMJudgeEngine(provider), mode: "llm" };
  }
  const selection = resolveDecisionEngine({});
  if (selection.mode === "offline" && !quiet) {
    warn("没有检测到 TYPESAFE_API_KEY，回落到离线词面判定引擎（结果仅供演示）");
  }
  return { engine: selection.engine, mode: selection.mode };
}

function payloadOf(value: unknown): AnswerPayload | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") fail("作答必须是对象或 null");
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "mcq":
      return { type: "mcq", index: typeof record.index === "number" ? record.index : null };
    case "true_false":
      return { type: "true_false", value: typeof record.value === "boolean" ? record.value : null };
    case "cloze":
      return { type: "cloze", text: typeof record.text === "string" ? record.text : "" };
    case "short_answer":
      return { type: "short_answer", text: typeof record.text === "string" ? record.text : "" };
    default:
      fail(`未知的作答类型：${String(record.type)}`);
  }
}

function warn(message: string): void {
  console.warn(`⚠️  ${message}`);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function line(message = ""): void {
  console.log(message);
}

/* ------------------------------- commands ------------------------------- */

async function commandAnswerTemplate(flags: Parsed): Promise<void> {
  const examPath = flags.exam;
  const out = flags.out;
  if (typeof examPath !== "string" || typeof out !== "string") {
    fail("用法：study.ts answer-template --exam <exam.json> --out <answers.json>");
  }
  const exam = await loadExam(examPath);
  const answers = exam.questions.map((question) => {
    const payload: AnswerPayload =
      question.type === "mcq"
        ? { type: "mcq", index: null }
        : question.type === "true_false"
          ? { type: "true_false", value: null }
          : question.type === "cloze"
            ? { type: "cloze", text: "" }
            : { type: "short_answer", text: "" };
    return { questionId: question.id, payload };
  });
  await writeJson(out, { version: 1, answers });
  line(`✓ 已生成作答模板：${out}（${answers.length} 题）`);
}

async function commandVerify(flags: Parsed): Promise<void> {
  const materialPath = flags.material;
  const examPath = flags.exam;
  if (typeof materialPath !== "string" || typeof examPath !== "string") {
    fail("用法：study.ts verify --material <file> --exam <exam.json> [--out verify.json] [--strict]");
  }
  const material = await readText(materialPath);
  const exam = await loadExam(examPath);
  const scan = scanMaterial(material);
  const violations = verifyProvenance(material, exam.questions);
  const coverage = verifyCoverage(material, exam.topics, exam.questions);

  const report = {
    material: {
      path: materialPath,
      charCount: scan.charCount,
      truncated: scan.truncated,
      hazards: scan.hazards,
    },
    contract: PROVENANCE_CONTRACT,
    provenanceViolations: violations,
    coverage,
  };

  line(`材料：${materialPath}（${scan.charCount} 字符）`);
  line(`安全扫描：${summarizeHazards(scan.hazards)}`);
  line(`溯源契约：${violations.length === 0 ? "全部材料字段可在原文定位" : `${violations.length} 处未通过`}`);
  line(`覆盖率：${coverageSummary(coverage)}`);
  for (const violation of violations.slice(0, 8)) {
    line(`  - ${violation.questionId} · ${violation.field}：${violation.reason}`);
  }
  if (coverage.uncovered.length > 0) {
    line("未覆盖的材料要点：");
    for (const unit of coverage.uncovered.slice(0, 8)) {
      line(`  - 第 ${unit.index + 1} 句：${unit.text.slice(0, 60)}`);
    }
  }

  if (typeof flags.out === "string") {
    await writeJson(flags.out, report);
    line(`✓ 校验结果已写入 ${flags.out}`);
  }

  if (flags.strict === true && (violations.length > 0 || coverage.anchorFailures.length > 0)) {
    fail("严格模式下存在未通过项");
  }
}

async function commandGrade(flags: Parsed): Promise<void> {
  const materialPath = flags.material;
  const examPath = flags.exam;
  const answersPath = flags.answers;
  if (typeof materialPath !== "string" || typeof examPath !== "string" || typeof answersPath !== "string") {
    fail("用法：study.ts grade --material <file> --exam <exam.json> --answers <answers.json> [--out ./learning_work]");
  }

  const material = await readText(materialPath);
  const exam = await loadExam(examPath);
  const answersRaw = await readJson<unknown>(answersPath);
  const parsedAnswers = answerFileSchema.safeParse(answersRaw);
  if (!parsedAnswers.success) fail(`作答文件结构不合法：${parsedAnswers.error.message}`);

  const answerMap = new Map<string, AnswerPayload | null>();
  for (const answer of parsedAnswers.data.answers) {
    answerMap.set(answer.questionId, payloadOf(answer.payload));
  }

  const { engine, mode } = pickEngine(typeof flags.engine === "string" ? flags.engine : undefined);
  const judgments = new Map<string, Awaited<ReturnType<typeof gradeQuestion>>>();
  for (const question of exam.questions) {
    const judgment = await gradeQuestion(question, answerMap.get(question.id) ?? null, {
      engine,
      materialExcerpt: material,
    });
    judgments.set(question.id, judgment);
  }

  const scan = scanMaterial(material);
  const violations = verifyProvenance(material, exam.questions);
  const coverage = verifyCoverage(material, exam.topics, exam.questions);
  const studyReport = buildStudyReport({
    material: { title: flags.title && typeof flags.title === "string" ? flags.title : exam.title, rawText: material },
    topics: exam.topics,
    questions: exam.questions,
    answers: answerMap,
    judgments,
    coverage,
    provenanceViolations: violations,
    engine: { id: engine.id, model: engine.model, mode },
    generator: exam.generator,
    examTitle: exam.title,
  });
  studyReport.material.hazards = scan.hazards;

  const outDir = typeof flags.out === "string" ? flags.out : "./learning_work";
  const base = resolve(outDir, "report");
  await writeJson(`${base}.json`, studyReport);
  await writeText(`${base}.html`, renderReportHtml(studyReport));
  await writeText(`${base}.md`, renderReportMarkdown(studyReport));

  line(`判定引擎：${engine.id} / ${engine.model}（${mode}）`);
  line(
    `总分：${studyReport.summary.scorePercent} / 100 · 待复核 ${studyReport.summary.needsReviewCount} 题 · 客观题正确 ${studyReport.summary.objectiveCorrect}/${studyReport.summary.objectiveTotal}`,
  );
  line(`覆盖率：${coverageSummary(coverage)}`);
  line(`✓ 已写出 ${base}.json / .html / .md`);
}

async function commandRender(flags: Parsed): Promise<void> {
  const reportPath = flags.report;
  const out = flags.out;
  if (typeof reportPath !== "string" || typeof out !== "string") {
    fail("用法：study.ts render --report report.json --out report.html [--md report.md]");
  }
  const report = await readJson<StudyReport>(reportPath);
  await writeText(out, renderReportHtml(report));
  line(`✓ 已渲染 ${out}`);
  if (typeof flags.md === "string") {
    await writeText(flags.md, renderReportMarkdown(report));
    line(`✓ 已渲染 ${flags.md}`);
  }
}

async function commandDemo(flags: Parsed): Promise<void> {
  const outDir = typeof flags.out === "string" ? flags.out : "docs/demo";
  const materialPath = "examples/agent-interview-notes.md";
  const material = await readText(materialPath);

  const provider = new HeuristicGenerationProvider();
  const outline = await provider.generateOutline({ materialText: material, topicCount: 3 });
  const generated = await provider.generateQuestions({
    materialText: material,
    topics: outline.topics,
    mix: { mcq: 3, true_false: 2, cloze: 1, short_answer: 1 },
    count: 7,
  });

  const examFile: ExamFile = {
    version: 1,
    title: "Agent 面试八股 · 检索与 Agent（示例试卷）",
    generator: `${provider.id}（离线启发式出题器，仅用于演示）`,
    topics: outline.topics,
    questions: generated.questions,
  };
  await writeJson(resolve(outDir, "exam.json"), examFile);

  // 示例作答：故意留一道错题和一道漏要点的简答，用来展示判定与待复核。
  const answers = generated.questions.map((question, index) => {
    if (question.type === "mcq") {
      const correct = index === 0 ? (question.correct_index + 1) % 4 : question.correct_index;
      return { questionId: question.id, payload: { type: "mcq", index: correct } };
    }
    if (question.type === "true_false") {
      return { questionId: question.id, payload: { type: "true_false", value: question.answer } };
    }
    if (question.type === "cloze") {
      return { questionId: question.id, payload: { type: "cloze", text: question.answer } };
    }
    const sentences = question.reference_answer.split("。");
    return {
      questionId: question.id,
      payload: {
        type: "short_answer",
        text: `${sentences.slice(0, 2).join("。")}。`,
      },
    };
  });
  await writeJson(resolve(outDir, "answers.json"), { version: 1, answers });

  const engine = new LexicalJudgeEngine();
  const answerMap = new Map<string, AnswerPayload | null>();
  for (const answer of answers) answerMap.set(answer.questionId, payloadOf(answer.payload));

  const judgments = new Map<string, Awaited<ReturnType<typeof gradeQuestion>>>();
  for (const question of generated.questions) {
    judgments.set(
      question.id,
      await gradeQuestion(question, answerMap.get(question.id) ?? null, {
        engine,
        materialExcerpt: material,
      }),
    );
  }

  const scan = scanMaterial(material);
  const coverage = verifyCoverage(material, outline.topics, generated.questions);
  const violations = verifyProvenance(material, generated.questions);
  const report = buildStudyReport({
    material: { title: "Agent 面试八股 · 检索与 Agent", rawText: material },
    topics: outline.topics,
    questions: generated.questions,
    answers: answerMap,
    judgments,
    coverage,
    provenanceViolations: violations,
    engine: { id: engine.id, model: engine.model, mode: "offline" },
    generator: examFile.generator,
    examTitle: examFile.title,
    generatedAt: "2026-09-24T00:00:00.000Z",
  });
  report.material.hazards = scan.hazards;

  await writeJson(resolve(outDir, "report.json"), report);
  await writeText(resolve(outDir, "report.html"), renderReportHtml(report));
  await writeText(resolve(outDir, "report.md"), renderReportMarkdown(report));

  line(`✓ 示例已生成到 ${outDir}/`);
  line(`  试卷 ${generated.questions.length} 题 · 覆盖 ${coverageSummary(coverage)}`);
  line(`  总分 ${report.summary.scorePercent} · 待复核 ${report.summary.needsReviewCount}`);
}

function printHelp(): void {
  line(`Jev 备考 · 命令行工具

  answer-template --exam exam.json --out answers.json
  verify          --material material.md --exam exam.json [--out verify.json] [--strict]
  grade           --material material.md --exam exam.json --answers answers.json [--out ./learning_work] [--engine offline|typesafe]
  render          --report report.json --out report.html [--md report.md]
  demo            [--out docs/demo]

试卷文件（exam.json）：
  { "title": "...", "generator": "agent", "topics": [...], "questions": [...] }

作答文件（answers.json）：
  { "answers": [ { "questionId": "q1", "payload": { "type": "mcq", "index": 1 } } ] }

判定引擎：
  默认按环境变量选择（TYPESAFE_API_KEY → Jev）；--engine offline 强制离线词面引擎（演示用）。`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "answer-template":
      return commandAnswerTemplate(flags);
    case "verify":
      return commandVerify(flags);
    case "grade":
      return commandGrade(flags);
    case "render":
      return commandRender(flags);
    case "demo":
      return commandDemo(flags);
    default:
      printHelp();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
