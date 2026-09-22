import type { QuestionType } from "@/lib/config";

/* ------------------------------------------------------------------ *
 * 决策模型（Jev / System One）的输入输出契约
 * ------------------------------------------------------------------ */

export type StructuredInstructions = string | Record<string, unknown>;

export type NoulQuestion = {
  type: "noul";
  instructions: StructuredInstructions;
  criteria?: StructuredInstructions;
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: StructuredInstructions;
  criteria: Record<string, StructuredInstructions>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: StructuredInstructions;
  criteria: StructuredInstructions[];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = {
  type: "noul";
  /** 命题为真的概率，0..1。注意：noul 不返回 confidence。 */
  noul: number;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
};

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type DecisionResult = {
  /** 引擎标识，例如 typesafe / llm-judge / lexical-demo */
  engineId: string;
  /** 具体模型版本，例如 jev-1.13.0 */
  model: string;
  answers: Record<string, DecisionAnswer>;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** 原始响应，落库用于审计与回归 */
  raw: unknown;
};

export type DecideOptions = { signal?: AbortSignal };

/**
 * 判定引擎抽象层：换掉 Jev 时只需换实现，业务代码不动。
 */
export interface DecisionEngine {
  readonly id: string;
  readonly model: string;
  decide(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
    options?: DecideOptions,
  ): Promise<DecisionResult>;
}

export class DecisionEngineError extends Error {
  readonly engineId: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { engineId: string; status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "DecisionEngineError";
    this.engineId = options.engineId;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/* ------------------------------------------------------------------ *
 * 出题契约
 * ------------------------------------------------------------------ */

export type Topic = {
  id: string;
  title: string;
  summary: string;
  /** 该知识点在材料中的原文片段，用于溯源 */
  source_spans: string[];
};

export type Outline = {
  topics: Topic[];
  generatorModel: string;
};

export type RubricPoint = {
  point_id: string;
  statement: string;
  weight: number;
  evidence_span: string;
};

type QuestionBase = {
  id: string;
  topic_id: string;
  type: QuestionType;
  stem: string;
  difficulty: "easy" | "medium" | "hard";
  /** 材料原文锚点；落地前必须能在原文中定位 */
  source_anchor: string;
  explanation?: string;
};

export type McqQuestion = QuestionBase & {
  type: "mcq";
  options: string[];
  correct_index: number;
};

export type TrueFalseQuestion = QuestionBase & {
  type: "true_false";
  answer: boolean;
};

export type ClozeQuestion = QuestionBase & {
  type: "cloze";
  /** 用 ____ 表示空位的句子 */
  text_with_blank: string;
  answer: string;
  accepted: string[];
};

export type ShortAnswerQuestion = QuestionBase & {
  type: "short_answer";
  reference_answer: string;
  rubric_points: RubricPoint[];
};

export type GeneratedQuestion =
  | McqQuestion
  | TrueFalseQuestion
  | ClozeQuestion
  | ShortAnswerQuestion;

export type AnswerKey = {
  mcq?: { correct_index: number };
  true_false?: { answer: boolean };
  cloze?: { answer: string; accepted: string[] };
  short_answer?: { reference_answer: string; rubric_points: RubricPoint[] };
};

/* ------------------------------------------------------------------ *
 * 判定结果
 * ------------------------------------------------------------------ */

export type JudgmentPoint = {
  point_id: string;
  statement: string;
  weight: number;
  /** noul 概率 */
  probability: number;
  /** |p-0.5|*2，模型对该点的判定强度 */
  strength: number;
  awarded: boolean;
};

export type JudgmentPenalty = {
  kind: "contradiction" | "fabrication";
  probability: number;
  weight: number;
  label: string;
};

export type JudgmentMethod = "exact" | "semantic" | "rubric";

export type Judgment = {
  method: JudgmentMethod;
  /** 0..1 的得分率 */
  score: number;
  scorePercent: number;
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
  /** 该判定是否真的调用了判定引擎（确定性判分时为 false，用于额度计量） */
  usedEngine: boolean;
  /** 待复核时给出的分数区间（[下限, 上限]） */
  scoreRange?: [number, number];
  points: JudgmentPoint[];
  penalties: JudgmentPenalty[];
  engineId: string;
  model: string;
  latencyMs: number;
  raw?: unknown;
};
