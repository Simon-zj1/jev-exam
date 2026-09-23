import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StudyReport } from "@/lib/report";

const repoRoot = process.cwd();
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");
const materialPath = join(repoRoot, "examples", "agent-interview-notes.md");

function run(args: string[], options: { expectFailure?: boolean } = {}): string {
  try {
    return execFileSync(tsx, ["scripts/study.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (options.expectFailure) {
      const failure = error as { stdout?: string; stderr?: string };
      return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }
    throw error;
  }
}

describe("命令行工具（Agent Skill 的执行入口）", () => {
  it("demo 生成试卷、作答与可打开的离线报告", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-study-"));
    const output = run(["demo", "--out", dir]);
    expect(output).toContain("示例已生成");

    for (const file of ["exam.json", "answers.json", "report.json", "report.html", "report.md"]) {
      expect(existsSync(join(dir, file))).toBe(true);
    }

    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as StudyReport;
    expect(report.questions.length).toBeGreaterThan(0);
    expect(report.coverage.unitCount).toBeGreaterThan(0);
    expect(report.engine.mode).toBe("offline");
    expect(report.provenanceViolations).toHaveLength(0);

    const html = readFileSync(join(dir, "report.html"), "utf8");
    expect(html).toContain("判定报告");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("verify 报告覆盖率与未覆盖要点", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-verify-"));
    run(["demo", "--out", dir]);
    const output = run([
      "verify",
      "--material",
      materialPath,
      "--exam",
      join(dir, "exam.json"),
      "--out",
      join(dir, "verify.json"),
    ]);

    expect(output).toContain("溯源契约");
    expect(output).toContain("覆盖率");
    const verify = JSON.parse(readFileSync(join(dir, "verify.json"), "utf8")) as {
      coverage: { unitCount: number; uncovered: unknown[] };
      provenanceViolations: unknown[];
    };
    expect(verify.coverage.unitCount).toBeGreaterThan(0);
    expect(verify.provenanceViolations).toHaveLength(0);
  });

  it("锚点无法定位时 verify --strict 失败", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-bad-"));
    const badExam = {
      version: 1,
      title: "坏试卷",
      generator: "test",
      topics: [],
      questions: [
        {
          id: "q1",
          topic_id: "t1",
          type: "true_false",
          stem: "判断：材料里没有这句话。",
          answer: true,
          difficulty: "easy",
          source_anchor: "这句话在材料里完全不存在，也无法定位。",
        },
      ],
    };
    const examPath = join(dir, "exam.json");
    writeFileSync(examPath, JSON.stringify(badExam), "utf8");

    const output = run(
      ["verify", "--material", materialPath, "--exam", examPath, "--strict"],
      { expectFailure: true },
    );
    expect(output).toContain("未通过");
    expect(output).toContain("source_anchor");
  });

  it("answer-template 产出与题目一一对应的作答骨架", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-answers-"));
    run(["demo", "--out", dir]);
    const answersPath = join(dir, "template.json");
    run(["answer-template", "--exam", join(dir, "exam.json"), "--out", answersPath]);

    const exam = JSON.parse(readFileSync(join(dir, "exam.json"), "utf8")) as {
      questions: { id: string; type: string }[];
    };
    const template = JSON.parse(readFileSync(answersPath, "utf8")) as {
      answers: { questionId: string; payload: { type: string } | null }[];
    };
    expect(template.answers).toHaveLength(exam.questions.length);
    expect(template.answers.map((answer) => answer.questionId)).toEqual(
      exam.questions.map((question) => question.id),
    );
  });
});
