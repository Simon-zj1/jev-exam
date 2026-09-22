import { GENERATOR_MAX_RETRIES } from "@/lib/config";
import { outlineSchema, generatedQuestionsPayloadSchema } from "@/lib/generator/schema";
import { locateAnchor, validateQuestions, type ValidationIssue } from "@/lib/generator/validate";
import type {
  GenerationProvider,
  OutlineRequest,
  QuestionRequest,
  QuestionResponse,
} from "@/lib/generator/provider";
import type { ChatProvider } from "@/lib/llm/provider";
import { truncate } from "@/lib/text";
import type { GeneratedQuestion, Outline, Topic } from "@/lib/types";

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export const OUTLINE_SYSTEM_PROMPT = [
  "你是备考题目设计专家。任务：把用户提供的学习材料切分成若干知识点。",
  "要求：",
  "1. 只依据材料本身，不得引入材料之外的知识。",
  "2. 每个知识点的 source_spans 必须是材料中逐字出现的原文片段（可直接在材料中检索到）。",
  '3. 只输出 JSON：{"topics":[{"id":"t1","title":"...","summary":"...","source_spans":["原文片段"]}]}。',
  "4. 不要输出解释、Markdown 代码块或任何其它文字。",
].join("\n");

export const QUESTIONS_SYSTEM_PROMPT = [
  "你是备考出题专家。任务：依据给定的知识点与材料原文，生成一套可自动判分的题目。",
  "题型与字段（严格遵循）：",
  '- mcq（单项选择）：{"id","topic_id","type":"mcq","stem","options":[4 个互不相同的选项],"correct_index":0-3,"difficulty":"easy|medium|hard","source_anchor":"材料原文片段"}',
  '- true_false（判断）：{"id","topic_id","type":"true_false","stem","answer":true|false,"difficulty","source_anchor"}',
  '- cloze（填空）：{"id","topic_id","type":"cloze","stem","text_with_blank":"含 ____ 的句子","answer":"答案","accepted":["可接受写法"],"difficulty","source_anchor"}',
  '- short_answer（简答）：{"id","topic_id","type":"short_answer","stem","reference_answer","rubric_points":[{"point_id","statement","weight","evidence_span"}],"difficulty","source_anchor"}',
  "硬性要求：",
  "1. 所有 source_anchor 与 evidence_span 必须是材料中逐字出现的片段，不得改写。",
  "2. 简答题必须有 3-6 条 rubric_points，每条对应一个独立得分点，weight 为正数（默认 1），statement 写成可判定真假的命题。",
  "3. 干扰项必须是同主题下容易被误认的内容，不要出现明显荒谬的选项。",
  '4. 只输出 JSON：{"questions":[...]}，不要输出任何其它文字。',
].join("\n");

/**
 * 由生成式模型出题（Jev 不生成文本，这一步只能由 LLM 完成）。
 * 输出必须通过 schema、锚点定位与去重校验，失败会带着原因重试，最终仍失败的题目直接丢弃。
 */
export class LlmGenerationProvider implements GenerationProvider {
  readonly id = "llm-generator";
  readonly model: string;
  readonly origin: "byok" | "platform";
  private readonly provider: ChatProvider;

  constructor(provider: ChatProvider) {
    this.provider = provider;
    this.model = provider.model;
    this.origin = provider.origin;
  }

  async generateOutline(request: OutlineRequest): Promise<Outline> {
    const user = [
      `请把下面材料切分为 ${request.topicCount} 个知识点。`,
      "材料：",
      "<<<",
      request.materialText,
      ">>>",
    ].join("\n");

    const response = await this.provider.complete({
      system: OUTLINE_SYSTEM_PROMPT,
      user,
      json: true,
      temperature: 0.2,
      maxTokens: 4000,
      signal: request.signal,
    });

    const parsed = outlineSchema.safeParse(parseJson(response.text));
    if (!parsed.success) {
      throw new GenerationError(`大纲输出不合法：${parsed.error.message}`);
    }

    const topics = parsed.data.topics.map((topic, index) => ({
      id: topic.id || `t${index + 1}`,
      title: topic.title,
      summary: topic.summary,
      source_spans: topic.source_spans.filter(
        (span) => locateAnchor(request.materialText, span).found,
      ),
    }));

    const usable = topics.filter((topic) => topic.source_spans.length > 0);
    if (usable.length === 0) {
      throw new GenerationError("大纲中没有任何可定位的原文片段");
    }

    return { topics: usable, generatorModel: response.model };
  }

  async generateQuestions(request: QuestionRequest): Promise<QuestionResponse> {
    const collected: GeneratedQuestion[] = [];
    const issues: ValidationIssue[] = [];
    let lastModel = this.model;
    const topicIds = new Set(request.topics.map((topic) => topic.id));
    const outline: Topic[] = request.topics;

    for (let attempt = 0; attempt <= GENERATOR_MAX_RETRIES; attempt += 1) {
      const remaining = request.count - collected.length;
      if (remaining <= 0) break;

      const user = buildQuestionPrompt({
        material: request.materialText,
        topics: outline,
        mix: request.mix,
        count: remaining,
        previousIssues: attempt === 0 ? [] : issues.slice(-8),
      });

      let raw: unknown;
      try {
        const response = await this.provider.complete({
          system: QUESTIONS_SYSTEM_PROMPT,
          user,
          json: true,
          temperature: 0.4,
          maxTokens: 8000,
          signal: request.signal,
        });
        lastModel = response.model;
        raw = parseJson(response.text);
      } catch (error) {
        issues.push({
          index: -1,
          code: "schema_invalid",
          message: `第 ${attempt + 1} 次调用失败：${(error as Error).message}`,
        });
        continue;
      }

      const payload = generatedQuestionsPayloadSchema.safeParse(raw);
      if (!payload.success) {
        issues.push({
          index: -1,
          code: "schema_invalid",
          message: `顶层结构不合法：${payload.error.message}`,
        });
        continue;
      }

      const result = validateQuestions(payload.data.questions, request.materialText, topicIds);
      issues.push(...result.issues);
      for (const question of result.valid) {
        if (collected.length >= request.count) break;
        collected.push(question);
      }
    }

    if (collected.length === 0) {
      throw new GenerationError(
        `出题失败，所有候选都未通过校验：${issues
          .slice(0, 5)
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }

    return { questions: collected, model: lastModel, raw: { issues } };
  }
}

function buildQuestionPrompt(input: {
  material: string;
  topics: Topic[];
  mix: Record<string, number>;
  count: number;
  previousIssues: ValidationIssue[];
}): string {
  const mixLines = Object.entries(input.mix)
    .filter(([, value]) => value > 0)
    .map(([type, value]) => `- ${type}: 占比 ${value}`)
    .join("\n");

  const topicLines = input.topics
    .map((topic) => `- id=${topic.id} 标题=${topic.title} 要点=${truncate(topic.summary, 120)}`)
    .join("\n");

  const feedback =
    input.previousIssues.length > 0
      ? [
          "上一轮输出存在下列问题，请修正后重新输出完整 JSON：",
          ...input.previousIssues.map((issue) => `- ${issue.message}`),
        ].join("\n")
      : "";

  return [
    `请生成 ${input.count} 道题，题型配比：`,
    mixLines,
    "",
    `可用知识点（topic_id 必须取自这里）：`,
    topicLines,
    "",
    "材料原文：",
    "<<<",
    input.material,
    ">>>",
    feedback,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new GenerationError("模型输出不是合法 JSON");
  }
}
