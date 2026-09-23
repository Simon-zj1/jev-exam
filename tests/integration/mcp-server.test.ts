import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");
const materialPath = join(repoRoot, "examples", "agent-interview-notes.md");

type RpcResponse = { id?: number; result?: unknown; error?: unknown };

function rpc(messages: unknown[]): RpcResponse[] {
  const stdout = execFileSync(tsx, ["scripts/mcp-server.ts"], {
    cwd: repoRoot,
    input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RpcResponse);
}

function makeExam(): unknown {
  const dir = mkdtempSync(join(tmpdir(), "jev-mcp-"));
  execFileSync(tsx, ["scripts/study.ts", "demo", "--out", dir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(readFileSync(join(dir, "exam.json"), "utf8"));
}

describe("MCP server", () => {
  it("完成 initialize 握手并暴露四个工具", () => {
    const responses = rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    const init = responses.find((response) => response.id === 1)?.result as {
      serverInfo: { name: string };
      capabilities: { tools: unknown };
    };
    expect(init.serverInfo.name).toBe("jev-exam");
    expect(init.capabilities.tools).toBeDefined();

    const list = responses.find((response) => response.id === 2)?.result as {
      tools: { name: string; inputSchema: unknown }[];
    };
    expect(list.tools.map((tool) => tool.name).sort()).toEqual([
      "answer_template",
      "grade_answers",
      "render_report",
      "verify_exam",
    ]);
    expect(list.tools.every((tool) => tool.inputSchema)).toBe(true);
  });

  it("verify_exam 返回溯源契约、覆盖率与材料安全扫描", () => {
    const material = readFileSync(materialPath, "utf8");
    const responses = rpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "verify_exam", arguments: { materialText: material, exam: makeExam() } },
      },
    ]);

    const result = responses[0].result as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text) as {
      passed: boolean;
      security: { summary: string };
      coverage: { summary: string; unitCount: number };
      provenanceViolations: unknown[];
    };
    expect(payload.passed).toBe(true);
    expect(payload.provenanceViolations).toHaveLength(0);
    expect(payload.coverage.unitCount).toBeGreaterThan(0);
    expect(payload.security.summary).toContain("未发现");
  });

  it("grade_answers + render_report 串起来能产出离线 HTML", () => {
    const material = readFileSync(materialPath, "utf8");
    const exam = makeExam() as { questions: { id: string; type: string }[] };
    const answers = exam.questions.map((question) => ({
      questionId: question.id,
      payload:
        question.type === "mcq"
          ? { type: "mcq", index: 0 }
          : question.type === "true_false"
            ? { type: "true_false", value: true }
            : question.type === "cloze"
              ? { type: "cloze", text: "检索" }
              : { type: "short_answer", text: "检索阶段用向量检索做语义召回。" },
    }));

    const responses = rpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "grade_answers",
          arguments: { materialText: material, exam, answers, engine: "offline" },
        },
      },
    ]);
    const report = JSON.parse(
      (responses[0].result as { content: { text: string }[] }).content[0].text,
    ) as { questions: unknown[]; coverage: { unitCount: number } };
    expect(report.questions.length).toBe(exam.questions.length);

    const rendered = rpc([
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "render_report", arguments: { report } },
      },
    ]);
    const html = (rendered[0].result as { content: { text: string }[] }).content[0].text;
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("材料原文");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("工具报错时返回 isError 而不是崩溃", () => {
    const responses = rpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "verify_exam", arguments: { exam: { questions: [] } } },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "不存在的工具", arguments: {} } },
    ]);
    for (const response of responses) {
      const result = response.result as { isError: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0].text.length).toBeGreaterThan(0);
    }
  });
});
