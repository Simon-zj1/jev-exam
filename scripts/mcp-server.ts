#!/usr/bin/env tsx
/**
 * Jev 备考 · MCP server（stdio，JSON-RPC 2.0）。
 *
 * 让 Claude Code / Codex / Cursor 这类支持 MCP 的 Agent 直接调用能力，
 * 而不需要自己拼 shell 命令：
 *   - verify_exam      校验试卷（schema、溯源契约、覆盖率、不可信材料扫描）
 *   - answer_template  生成作答骨架
 *   - grade_answers    用判定引擎判分并产出报告
 *   - render_report    把报告渲染成离线单文件 HTML
 *
 * 注册方式（客户端配置里）：
 *   { "mcpServers": { "jev-exam": { "command": "npx", "args": ["-y", "jev-exam@latest", "mcp"] } } }
 */
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { coverageSummary, verifyCoverage } from "@/lib/coverage";
import { resolveDecisionEngine } from "@/lib/engine";
import { LexicalJudgeEngine } from "@/lib/engine/lexical";
import { LLMJudgeEngine } from "@/lib/engine/llm-judge";
import { TypeSafeEngine } from "@/lib/engine/typesafe";
import { gradeQuestion, type AnswerPayload } from "@/lib/grading";
import { generatedQuestionSchema } from "@/lib/generator/schema";
import { resolvePlatformChatProvider } from "@/lib/llm/provider";
import { verifyProvenance } from "@/lib/provenance";
import { buildStudyReport, renderReportHtml, type StudyReport } from "@/lib/report";
import { scanMaterial, summarizeHazards } from "@/lib/security/untrusted";
import type { DecisionEngine, GeneratedQuestion, Topic } from "@/lib/types";

const SERVER_INFO = { name: "jev-exam", version: "0.3.0" };
const PROTOCOL_VERSION = "2024-11-05";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const examSchemaFragment = {
  type: "object",
  description: "试卷对象：{ title, generator, topics[], questions[] }",
  properties: {
    title: { type: "string" },
    generator: { type: "string" },
    topics: { type: "array", items: { type: "object" } },
    questions: { type: "array", items: { type: "object" } },
  },
  required: ["questions"],
} as const;

const TOOLS: Tool[] = [
  {
    name: "verify_exam",
    description:
      "校验试卷：schema、溯源契约（材料事实是否可逐字定位）、覆盖率（哪些材料要点没被出题）、材料是否含疑似指令性内容。",
    inputSchema: {
      type: "object",
      properties: {
        materialText: { type: "string", description: "材料全文（与 materialPath 二选一）" },
        materialPath: { type: "string", description: "材料文件路径（与 materialText 二选一）" },
        exam: examSchemaFragment,
      },
      required: ["exam"],
    },
  },
  {
    name: "answer_template",
    description: "按试卷生成作答骨架（answers.json 的结构），供学习者填写。",
    inputSchema: { type: "object", properties: { exam: examSchemaFragment }, required: ["exam"] },
  },
  {
    name: "grade_answers",
    description:
      "用判定引擎判分：客观题走确定性比对，主观题逐得分点判定并按权重合成；返回总分、待复核数量、覆盖率与逐点结论。engine 取 auto / typesafe / llm / offline。",
    inputSchema: {
      type: "object",
      properties: {
        materialText: { type: "string" },
        materialPath: { type: "string" },
        exam: examSchemaFragment,
        answers: {
          type: "array",
          description: '[{ "questionId": "q1", "payload": { "type": "mcq", "index": 0 } }]',
          items: { type: "object" },
        },
        engine: { type: "string", enum: ["auto", "typesafe", "llm", "offline"] },
      },
      required: ["exam", "answers"],
    },
  },
  {
    name: "render_report",
    description: "把 grade_answers 返回的 report 渲染成离线单文件 HTML（无外部请求）。",
    inputSchema: { type: "object", properties: { report: { type: "object" } }, required: ["report"] },
  },
];

type ExamPayload = {
  title?: string;
  generator?: string;
  topics?: Topic[];
  questions: unknown[];
};

async function readText(args: Record<string, unknown>): Promise<string> {
  if (typeof args.materialText === "string" && args.materialText.trim().length > 0) {
    return args.materialText;
  }
  if (typeof args.materialPath === "string") {
    return readFile(resolve(args.materialPath), "utf8");
  }
  throw new Error("需要 materialText 或 materialPath 之一");
}

function parseExam(value: unknown): { topics: Topic[]; questions: GeneratedQuestion[] } {
  if (typeof value !== "object" || value === null) throw new Error("exam 必须是对象");
  const exam = value as ExamPayload;
  if (!Array.isArray(exam.questions) || exam.questions.length === 0) {
    throw new Error("exam.questions 不能为空");
  }
  const questions: GeneratedQuestion[] = [];
  for (const [index, candidate] of exam.questions.entries()) {
    const parsed = generatedQuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        `第 ${index + 1} 题不符合契约：${parsed.error.issues
          .slice(0, 2)
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }
    questions.push(parsed.data as GeneratedQuestion);
  }
  return { topics: Array.isArray(exam.topics) ? exam.topics : [], questions };
}

function pickEngine(flag: unknown): { engine: DecisionEngine; mode: string } {
  if (flag === "offline") return { engine: new LexicalJudgeEngine(), mode: "offline" };
  if (flag === "typesafe") {
    const engine = TypeSafeEngine.fromEnv();
    if (!engine) throw new Error("engine=typesafe 需要 TYPESAFE_API_KEY");
    return { engine, mode: "typesafe" };
  }
  if (flag === "llm") {
    const provider = resolvePlatformChatProvider();
    if (!provider) throw new Error("engine=llm 需要一个 OpenAI 兼容的 key（AI_API_KEY 或 PLATFORM_LLM_API_KEY）");
    return { engine: new LLMJudgeEngine(provider), mode: "llm" };
  }
  const selection = resolveDecisionEngine({});
  return { engine: selection.engine, mode: selection.mode };
}

function payloadOf(value: unknown): AnswerPayload | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new Error("payload 必须是对象或 null");
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
      throw new Error(`未知的作答类型：${String(record.type)}`);
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "verify_exam": {
      const material = await readText(args);
      const exam = parseExam(args.exam);
      const scan = scanMaterial(material);
      const violations = verifyProvenance(material, exam.questions);
      const coverage = verifyCoverage(material, exam.topics, exam.questions);
      return JSON.stringify(
        {
          passed: violations.length === 0 && coverage.anchorFailures.length === 0,
          security: { summary: summarizeHazards(scan.hazards), hazards: scan.hazards },
          provenanceViolations: violations,
          coverage: {
            summary: coverageSummary(coverage),
            unitCount: coverage.unitCount,
            coveredCount: coverage.coveredCount,
            uncovered: coverage.uncovered,
            topicCoverage: coverage.topicCoverage,
          },
        },
        null,
        2,
      );
    }
    case "answer_template": {
      const exam = parseExam(args.exam);
      return JSON.stringify(
        {
          version: 1,
          answers: exam.questions.map((question) => ({
            questionId: question.id,
            payload:
              question.type === "mcq"
                ? { type: "mcq", index: null }
                : question.type === "true_false"
                  ? { type: "true_false", value: null }
                  : question.type === "cloze"
                    ? { type: "cloze", text: "" }
                    : { type: "short_answer", text: "" },
          })),
        },
        null,
        2,
      );
    }
    case "grade_answers": {
      const material = await readText(args);
      const exam = parseExam(args.exam);
      if (!Array.isArray(args.answers)) throw new Error("answers 必须是数组");
      const answerMap = new Map<string, AnswerPayload | null>();
      for (const entry of args.answers as { questionId?: unknown; payload?: unknown }[]) {
        if (typeof entry.questionId !== "string") throw new Error("answers[].questionId 必须是字符串");
        answerMap.set(entry.questionId, payloadOf(entry.payload));
      }
      const { engine, mode } = pickEngine(args.engine);
      const judgments = new Map<string, Awaited<ReturnType<typeof gradeQuestion>>>();
      for (const question of exam.questions) {
        judgments.set(
          question.id,
          await gradeQuestion(question, answerMap.get(question.id) ?? null, {
            engine,
            materialExcerpt: material,
          }),
        );
      }
      const report = buildStudyReport({
        material: { title: typeof args.title === "string" ? args.title : "学习材料", rawText: material },
        topics: exam.topics,
        questions: exam.questions,
        answers: answerMap,
        judgments,
        coverage: verifyCoverage(material, exam.topics, exam.questions),
        provenanceViolations: verifyProvenance(material, exam.questions),
        engine: { id: engine.id, model: engine.model, mode },
        generator: typeof args.generator === "string" ? args.generator : "agent",
        examTitle: typeof args.title === "string" ? args.title : "试卷",
      });
      report.material.hazards = scanMaterial(material).hazards;
      return JSON.stringify(report, null, 2);
    }
    case "render_report": {
      if (typeof args.report !== "object" || args.report === null) {
        throw new Error("report 必须是 grade_answers 返回的对象");
      }
      return renderReportHtml(args.report as StudyReport);
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

async function handle(request: JsonRpcRequest): Promise<unknown | null> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const params = request.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await callTool(name, args);
        return { content: [{ type: "text", text }], isError: false };
      } catch (error) {
        return {
          content: [{ type: "text", text: `工具执行失败：${(error as Error).message}` }],
          isError: true,
        };
      }
    }
    default:
      throw new Error(`不支持的方法：${request.method}`);
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  let queue = Promise.resolve();

  /**
   * 往 stdout 写一行并等待真正写完。
   * 报告类响应有十几 KB，pipe 写入是异步的；不等回调就 process.exit 会把 JSON 截断，
   * 客户端会收到「Unterminated string」这种看起来像协议错误的报错。
   */
  const writeLine = (payload: unknown): Promise<void> =>
    new Promise((resolveWrite) => {
      process.stdout.write(`${JSON.stringify(payload)}\n`, () => resolveWrite());
    });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    queue = queue.then(async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        await writeLine({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "解析失败" },
        });
        return;
      }
      if (request.id === undefined || request.id === null) {
        // 通知类消息不需要响应
        try {
          await handle(request);
        } catch {
          /* 通知失败静默 */
        }
        return;
      }
      try {
        const result = await handle(request);
        await writeLine({ jsonrpc: "2.0", id: request.id, result });
      } catch (error) {
        await writeLine({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: (error as Error).message },
        });
      }
    });
  });

  rl.on("close", () => {
    // 等队列与 stdout 都排空后自然退出；不要 process.exit，否则可能丢数据。
    queue.then(() => {
      process.exitCode = 0;
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
