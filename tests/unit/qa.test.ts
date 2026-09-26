import { describe, expect, it } from "vitest";
import {
  countModelSupplements,
  extractMarkers,
  findUncitedSentences,
  verifyCitations,
} from "@/lib/qa/citations";
import { buildUnits, retrieveEvidence, tokenizeForRetrieval } from "@/lib/retrieval";

const MATERIAL = [
  "检索是 RAG 的第一阶段，决定模型能看到什么证据。",
  "向量检索把文本编码成向量，用相似度做语义召回。",
  "关键词检索用 BM25 之类的算法补足专有名词与精确匹配。",
  "重排用 Rerank 模型对召回结果重新打分，把最相关的证据排到前面。",
  "评估阶段同时看召回率与忠实度。",
].join("\n");

describe("证据检索", () => {
  it("选出与问题相关的句子，并保留原文顺序", () => {
    const result = retrieveEvidence(MATERIAL, "向量检索是怎么做的？", { topK: 3 });
    expect(result.evidence.length).toBeGreaterThan(0);
    // 最相关的那句必须被选进来（返回时按原文顺序，所以不能假定它在第 0 位）
    const best = [...result.evidence].sort((a, b) => b.score - a.score)[0];
    expect(best.text).toContain("向量检索");
    // 返回时按原文顺序，读者可以顺着材料读
    const indices = result.evidence.map((unit) => unit.unitIndex);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    expect(result.matchedTermCount).toBeGreaterThan(0);
  });

  it("字符偏移能在原文里定位到该句", () => {
    const units = buildUnits(MATERIAL);
    for (const unit of units) {
      expect(MATERIAL.slice(unit.charStart, unit.charEnd)).toBe(unit.text);
    }
  });

  it("材料里确实没有的内容检索不到", () => {
    const result = retrieveEvidence(MATERIAL, "请证明黎曼猜想", { topK: 3 });
    expect(result.evidence.length).toBe(0);
  });

  it("英文按单词切分，复数与单数能对上", () => {
    const tokens = tokenizeForRetrieval("Vector search encodes text into vectors.");
    expect(tokens.has("vector")).toBe(true);
    expect(tokens.has("search")).toBe(true);
    // 整句不能被当成一个 token（这正是英文提问检索不到的原因）
    expect([...tokens].some((token) => token.length > 20)).toBe(false);

    const english = "Vector search encodes text into vectors.\nReranking rescores the recalled passages.";
    const result = retrieveEvidence(english, "how does vector search work?", { topK: 2 });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].text).toContain("Vector search");
  });
});

describe("引注校验", () => {
  const evidence = retrieveEvidence(MATERIAL, "向量检索 BM25 重排", { topK: 4 }).evidence;

  it("识别 [1] 与【1】两种写法，也支持 [1,2]", () => {
    expect(extractMarkers("这是[1]和【2】以及[3,4]")).toEqual([1, 2, 3, 4]);
  });

  it("越界编号会被删除并记为问题", () => {
    const check = verifyCitations("向量检索用相似度召回[1]，另一件事见[9]。", evidence);
    expect(check.citations.map((citation) => citation.marker)).toEqual([1]);
    expect(check.answer).not.toContain("[9]");
    expect(check.issues.some((issue) => issue.kind === "unknown_citation")).toBe(true);
  });

  it("没有引注的实质性句子会被单独列出", () => {
    const check = verifyCitations(
      "向量检索把文本编码成向量[1]。\n这个方法在所有数据集上都优于关键词检索，成本也更低。",
      evidence,
    );
    const uncited = check.issues.filter((issue) => issue.kind === "uncited_sentence");
    expect(uncited).toHaveLength(1);
    expect(uncited[0].excerpt).toContain("所有数据集");
  });

  it("【模型补充】的句子不算「没有出处」", () => {
    expect(findUncitedSentences("【模型补充】也可以用混合检索，这里材料没提。")).toHaveLength(0);
    expect(countModelSupplements("【模型补充】一。正文【模型补充】二。")).toBe(2);
  });

  it("整段没有引注时给出 no_citation", () => {
    const check = verifyCitations("我觉得这件事大概是这样的。", evidence);
    expect(check.issues.some((issue) => issue.kind === "no_citation")).toBe(true);
  });
});
