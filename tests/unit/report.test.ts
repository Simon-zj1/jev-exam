import { describe, expect, it } from "vitest";
import { verifyCoverage } from "@/lib/coverage";
import { gradeQuestion } from "@/lib/grading";
import { LexicalJudgeEngine } from "@/lib/engine/lexical";
import { verifyProvenance } from "@/lib/provenance";
import {
  buildStudyReport,
  renderReportHtml,
  renderReportMarkdown,
  type StudyReport,
} from "@/lib/report";
import type { GeneratedQuestion, Topic } from "@/lib/types";

const material =
  "检索是 RAG 的第一阶段，决定模型能看到什么证据。\n向量检索：把文本编码成向量，用相似度做语义召回。";

const topics: Topic[] = [
  {
    id: "t1",
    title: "检索",
    summary: "检索阶段",
    source_spans: ["检索是 RAG 的第一阶段，决定模型能看到什么证据。"],
  },
];

const questions: GeneratedQuestion[] = [
  {
    id: "q1",
    topic_id: "t1",
    type: "true_false",
    stem: "判断：检索决定模型能看到什么证据。",
    answer: true,
    difficulty: "easy",
    source_anchor: "检索是 RAG 的第一阶段，决定模型能看到什么证据。",
    explanation: "这句直接取自材料 <script>alert(1)</script>",
  },
];

async function buildReport(): Promise<StudyReport> {
  const engine = new LexicalJudgeEngine();
  const answers = new Map([["q1", { type: "true_false" as const, value: true }]]);
  const judgments = new Map([
    ["q1", await gradeQuestion(questions[0], answers.get("q1") ?? null, { engine, materialExcerpt: material })],
  ]);
  return buildStudyReport({
    material: { title: "示例材料", rawText: material },
    topics,
    questions,
    answers,
    judgments,
    coverage: verifyCoverage(material, topics, questions),
    provenanceViolations: verifyProvenance(material, questions),
    engine: { id: engine.id, model: engine.model, mode: "offline" },
    generator: "test",
    examTitle: "示例试卷",
    generatedAt: "2026-09-24T00:00:00.000Z",
  });
}

describe("静态报告渲染", () => {
  it("HTML 自包含：不引用任何外部资源，且转义材料与模型输出", async () => {
    const html = renderReportHtml(await buildReport());

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("材料原文");
    expect(html).toContain("模型补充");
    expect(html).toContain("第 1 句 / 共 2 句");
  });

  it("Markdown 报告包含逐点判定表与未覆盖要点", async () => {
    const report = await buildReport();
    const markdown = renderReportMarkdown(report);

    expect(markdown).toContain("# 示例材料 · 判定报告");
    expect(markdown).toContain("向量检索");
    expect(markdown).toContain("未覆盖的材料要点");
  });

  it("报告 JSON 结构稳定，便于二次消费", async () => {
    const report = await buildReport();
    expect(report.version).toBe(1);
    expect(report.questions[0].judgment.method).toBe("exact");
    expect(report.summary.objectiveTotal).toBe(1);
    expect(report.summary.objectiveCorrect).toBe(1);
    expect(report.coverage.unitCount).toBe(2);
  });
});
