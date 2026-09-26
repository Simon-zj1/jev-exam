/**
 * 全局可调参数。判定阈值集中在这里，方便 eval 回归时统一调参。
 */

export const APP_NAME = "Jev 备考";
export const APP_TAGLINE = "上传你的材料，自动出一套题，用决策模型逐点判分";

/** choice / score 答案自带的 confidence 低于该值时进入待复核。 */
export const CONFIDENCE_THRESHOLD = 0.75;

/**
 * noul（是/否）答案没有 confidence 字段，用概率偏离 0.5 的幅度衡量判定强度：
 * strength = |p - 0.5| * 2，取值 0..1。低于阈值视为“模型也没把握”。
 */
export const NOUL_STRENGTH_THRESHOLD = 0.5;

/** 权重达到该值的 rubric 点算“关键点”，关键点不确定即整题待复核。 */
export const KEY_POINT_MIN_WEIGHT = 0.2;

/** 主观题的代码侧扣分权重（不交给模型决定）。 */
export const CONTRADICTION_PENALTY = 0.3;
export const FABRICATION_PENALTY = 0.3;

export type QuestionType = "mcq" | "true_false" | "cloze" | "short_answer";

export const QUESTION_TYPES: QuestionType[] = ["mcq", "true_false", "cloze", "short_answer"];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "单项选择",
  true_false: "判断",
  cloze: "填空",
  short_answer: "简答",
};

/** 默认题型配比，生成前用户可调。 */
export const DEFAULT_QUESTION_MIX: Record<QuestionType, number> = {
  mcq: 0.5,
  true_false: 0.2,
  cloze: 0.1,
  short_answer: 0.2,
};

export const DEFAULT_QUESTION_COUNT = 10;
export const MAX_QUESTION_COUNT = 30;
export const MIN_QUESTION_COUNT = 4;

/** 每人每日平台额度；BYOK 调用不占额度。 */
export const QUOTA_LIMITS = {
  material: 3,
  question: 100,
  judgment: 1000,
  ask: 200,
} as const;

export type QuotaKind = keyof typeof QUOTA_LIMITS;

/** 出题校验失败时的重试次数（之后丢弃该题）。 */
export const GENERATOR_MAX_RETRIES = 2;

/** source_anchor 至少要这么长才允许做定位校验。 */
export const ANCHOR_MIN_LENGTH = 8;

/** 题干近似去重阈值（字符 bigram Jaccard）。 */
export const DEDUPE_SIMILARITY_THRESHOLD = 0.85;

export const MAX_MATERIAL_CHARS = 120_000;

/**
 * 上传文件上限。Vercel 的 Serverless 请求体上限是 4.5 MB，
 * 取 4 MB 留出 multipart 边界的余量，避免线上才炸。
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4 MB";

/** PDF 最多解析多少页（页数上限之外的部分直接丢弃并提示）。 */
export const INGEST_MAX_PAGES = 200;

/** 材料问答：检索几条证据、最多引用几条。 */
export const ASK_TOP_K = 6;
export const ASK_MAX_CITATIONS = 6;
/** 检索不到任何证据时，直接如实回答「材料里没有」，不交给模型编。 */
export const ASK_MIN_EVIDENCE = 1;
export const ASK_MAX_QUESTION_CHARS = 400;

/** 客户端可见的公开配置（不含任何密钥）。 */
export function publicConfig() {
  return {
    appName: APP_NAME,
    tagline: APP_TAGLINE,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    noulStrengthThreshold: NOUL_STRENGTH_THRESHOLD,
    quotaLimits: QUOTA_LIMITS,
    defaultQuestionCount: DEFAULT_QUESTION_COUNT,
    maxQuestionCount: MAX_QUESTION_COUNT,
    minQuestionCount: MIN_QUESTION_COUNT,
    defaultMix: DEFAULT_QUESTION_MIX,
    questionTypeLabels: QUESTION_TYPE_LABEL,
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
