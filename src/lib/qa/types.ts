/**
 * 材料问答的答案契约。
 *
 * 与判定链路同一条原则：模型输出的每一句「材料里有」的话，都必须能指回原文，
 * 指不回去的部分要么被标成「模型补充」，要么被列进 issues。
 */

export type QaCitation = {
  /** 回答正文里使用的编号，从 1 开始 */
  marker: number;
  unitIndex: number;
  /** 材料原文，逐字未改写 */
  text: string;
  charStart: number;
  charEnd: number;
  /** PDF 才有页码 */
  page: number | null;
  /** 检索得分，便于排查「为什么选了这句」 */
  score: number;
};

export type QaIssueKind =
  | "unknown_citation"
  | "uncited_sentence"
  | "no_citation"
  | "insufficient_evidence"
  | "model_supplement";

export type QaIssue = {
  kind: QaIssueKind;
  /** 面向用户的中文说明 */
  detail: string;
  /** 相关的原句（如果有） */
  excerpt?: string;
};

export type QaMode = "llm" | "extractive" | "refused";

export type QaAnswer = {
  question: string;
  materialId: string;
  materialTitle: string;
  /** 回答正文，含 [n] 引注 */
  answer: string;
  citations: QaCitation[];
  mode: QaMode;
  model: string;
  engineMode: "byok" | "platform" | "offline";
  /** 材料里不足以回答时为 true，此时不调用模型、不消耗额度 */
  insufficient: boolean;
  issues: QaIssue[];
  /** 被正文实际引用到的证据条数 */
  citedCount: number;
  retrievedCount: number;
  /** 检索命中率：命中查询词数 / 查询词总数 */
  termCoverage: number;
  latencyMs: number;
};
