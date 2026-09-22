import { similarity } from "@/lib/text";
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionQuestion,
  DecisionResult,
} from "@/lib/types";

/**
 * 离线演示判定引擎（lexical-demo）。
 *
 * 仅用于在没有 TYPESAFE_API_KEY / PLATFORM_LLM_API_KEY 时把产品闭环跑通：
 * 用词面相似度近似“答案是否覆盖了该得分点”。它不是校准过的模型，
 * 质量远低于 Jev，禁止用于真实评分。
 */
export class LexicalJudgeEngine implements DecisionEngine {
  readonly id = "lexical-demo";
  readonly model = "lexical-demo-v1";

  async decide(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
  ): Promise<DecisionResult> {
    const startedAt = Date.now();
    const answers: Record<string, DecisionAnswer> = {};
    // 演示引擎只看“学生作答”这一侧，材料原文只用于矛盾/编造的对照问题。
    const stateText = extractAnswerText(state) || stringify(state);

    for (const [key, question] of Object.entries(questions)) {
      if (question.type === "noul") {
        // 演示引擎不做矛盾/编造检测，固定返回低概率（真实行为由 Jev 负责）。
        if (key === "contradicts" || key === "fabricates") {
          answers[key] = { type: "noul", noul: 0.05 };
          continue;
        }
        // 有路径引用时，比对目标就是被引用的实际内容（得分点、参考答案……），
        // 模板文字不再参与，否则“是否覆盖了这一得分点”这类套话会稀释重合度。
        const referenced = resolvePaths(question.instructions, state).trim();
        const target =
          referenced.length > 0 ? referenced : instructionText(question.instructions);
        const score = overlap(stateText, target);
        answers[key] = { type: "noul", noul: toProbability(score) };
        continue;
      }

      if (question.type === "choice") {
        const options = Object.keys(question.criteria);
        let best = options[0] ?? "";
        let bestScore = -1;
        const probabilities: Record<string, number> = {};
        for (const option of options) {
          const value = overlap(stateText, String(question.criteria[option]));
          probabilities[option] = value;
          if (value > bestScore) {
            bestScore = value;
            best = option;
          }
        }
        answers[key] = {
          type: "choice",
          choice: best,
          confidence: Math.min(0.6, 0.3 + Math.max(0, bestScore)),
          probabilities,
        };
        continue;
      }

      const levels = question.criteria;
      let bestIndex = 0;
      let bestScore = -1;
      const probabilities: Record<string, number> = {};
      levels.forEach((level, index) => {
        const value = overlap(stateText, instructionText(level));
        probabilities[String(index)] = value;
        if (value > bestScore) {
          bestScore = value;
          bestIndex = index;
        }
      });
      answers[key] = {
        type: "score",
        score: bestIndex,
        confidence: Math.min(0.6, 0.3 + Math.max(0, bestScore)),
        legend: Object.fromEntries(levels.map((level, index) => [String(index), instructionText(level)])),
        probabilities,
      };
    }

    return {
      engineId: this.id,
      model: this.model,
      answers,
      latencyMs: Date.now() - startedAt,
      raw: { engineId: this.id, answers },
    };
  }
}

function instructionText(instructions: unknown): string {
  if (typeof instructions === "string") return instructions;
  if (!instructions || typeof instructions !== "object") return "";

  const record = instructions as Record<string, unknown>;
  const preferred = ["question", "reference", "focus", "statement", "what"];
  const parts: string[] = [];
  for (const field of preferred) {
    const value = record[field];
    if (typeof value === "string") parts.push(value);
  }

  // 结构化字段（例如 point.statement）也要参与比对，否则无法判断“覆盖了哪个得分点”。
  for (const value of Object.values(record)) {
    if (typeof value === "string") continue;
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") parts.push(item);
      continue;
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        if (typeof nested === "string") parts.push(nested);
      }
    }
  }

  return parts.join(" ");
}

/**
 * 递归收集 instructions 里用反引号标注的路径引用。
 * 跳过 `inspect` 字段：它按约定指向学生自己的作答，把它拼进比对目标会自我应验。
 */
function collectPaths(value: unknown, paths: Set<string>, skipSelfReferences = false): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/`([^`]+)`/g)) paths.add(match[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, paths, skipSelfReferences);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (skipSelfReferences && key === "inspect") continue;
      collectPaths(nested, paths, skipSelfReferences);
    }
  }
}

/**
 * 把 `reference.answer`、`point.statement` 这类路径解析成实际文本。
 * 路径可能指向 state（材料、学生作答、参考答案），也可能指向 instructions 里
 * 自带的结构化字段（例如每个得分点自己的 point 对象），两边都要查。
 */
function resolvePaths(instructions: unknown, state: unknown): string {
  const paths = new Set<string>();
  collectPaths(instructions, paths, true);
  const values: string[] = [];
  for (const path of paths) {
    // 指向学生自己作答的引用不能进目标，否则会自我应验。
    if (/^(answer|student_answer)(\.|\[|$)/.test(path)) continue;
    const resolved = resolvePath(state, path) ?? resolvePath(instructions, path);
    if (resolved === undefined || resolved === null) continue;
    const text = contentText(resolved);
    if (text.length > 0) values.push(text);
  }
  return values.join(" ");
}

/** 只取有语义的内容字段，避免 JSON 键名（point_id、weight 等）稀释重合度。 */
const CONTENT_KEYS = [
  "statement",
  "evidence_span",
  "answer",
  "accepted",
  "text",
  "reference_answer",
  "summary",
  "what",
  "not_for",
  "examples",
];

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return "";
  if (Array.isArray(value)) {
    return value.map(contentText).filter((item) => item.length > 0).join(" ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return CONTENT_KEYS.filter((key) => key in record)
      .map((key) => contentText(record[key]))
      .filter((item) => item.length > 0)
      .join(" ");
  }
  return "";
}

function resolvePath(root: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = root;
  for (const segment of segments) {
    if (current === undefined || current === null) return undefined;
    const match = segment.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!match) return undefined;
    const [, key, indexes] = match;
    if (key) {
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    for (const index of indexes.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(index[1])];
    }
  }
  return current;
}

/** 演示引擎只把“学生作答”当作待判文本。 */
function extractAnswerText(state: string | Record<string, unknown>): string {
  if (typeof state === "string") return state;
  const candidates = [
    (state.answer as { text?: unknown } | undefined)?.text,
    (state.student_answer as { text?: unknown } | undefined)?.text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return "";
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function overlap(source: string, target: string): number {
  if (!target.trim()) return 0;
  const targetTokens = tokenize(target);
  if (targetTokens.length === 0) return 0;
  const sourceTokens = new Set(tokenize(source));
  let hits = 0;
  for (const token of targetTokens) {
    if (sourceTokens.has(token)) hits += 1;
  }
  const recall = hits / targetTokens.length;
  const jaccard = similarity(source, target);
  return 0.65 * recall + 0.35 * jaccard;
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9]+/g) ?? [];
  const chars = normalized.match(/[\u4e00-\u9fff]/g) ?? [];
  const bigrams: string[] = [];
  for (let i = 0; i < chars.length - 1; i += 1) {
    bigrams.push(`${chars[i]}${chars[i + 1]}`);
  }
  return [...latin, ...(chars.length === 1 ? chars : bigrams)];
}

/** 把 0..1 的相似度压成概率，避免全部挤在 0.5 附近。 */
function toProbability(score: number): number {
  const scaled = 0.5 + (score - 0.5) * 2.4;
  return Math.min(0.99, Math.max(0.01, Number(scaled.toFixed(4))));
}
