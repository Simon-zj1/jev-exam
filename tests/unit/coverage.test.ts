import { describe, expect, it } from "vitest";
import { coverageSummary, verifyCoverage } from "@/lib/coverage";
import type { GeneratedQuestion, Topic } from "@/lib/types";

const material = [
  "检索是 RAG 的第一阶段，决定模型能看到什么证据。",
  "向量检索：把文本编码成向量，用相似度做语义召回。",
  "关键词检索：用 BM25 之类的算法补足专有名词与精确匹配。",
  "重排：用 Rerank 模型对召回结果重新打分，提升 Top-K 精度。",
].join("\n");

const topics: Topic[] = [
  { id: "t1", title: "检索", summary: "检索阶段", source_spans: ["检索是 RAG 的第一阶段，决定模型能看到什么证据。"] },
];

function question(id: string, anchor: string, topicId = "t1"): GeneratedQuestion {
  return {
    id,
    topic_id: topicId,
    type: "true_false",
    stem: `判断：${anchor.slice(0, 12)}`,
    answer: true,
    difficulty: "easy",
    source_anchor: anchor,
  };
}

describe("覆盖率校验", () => {
  it("统计被题目锚点覆盖的材料要点", () => {
    const report = verifyCoverage(material, topics, [
      question("q1", "检索是 RAG 的第一阶段，决定模型能看到什么证据。"),
      question("q2", "向量检索：把文本编码成向量，用相似度做语义召回。"),
    ]);

    expect(report.unitCount).toBe(4);
    expect(report.coveredCount).toBe(2);
    expect(report.coverageRatio).toBeCloseTo(0.5, 5);
    expect(report.uncovered.map((unit) => unit.index)).toEqual([2, 3]);
    expect(report.anchorFailures).toHaveLength(0);
  });

  it("锚点无法定位时记为 anchorFailure，而不是算作覆盖", () => {
    const report = verifyCoverage(material, topics, [
      question("q1", "线粒体是细胞进行有氧呼吸的主要场所。"),
    ]);

    expect(report.anchorFailures).toHaveLength(1);
    expect(report.anchorFailures[0].questionId).toBe("q1");
    expect(report.coveredCount).toBe(0);
  });

  it("标记没有出题的知识点，并在摘要里说明", () => {
    const report = verifyCoverage(
      material,
      [...topics, { id: "t2", title: "重排", summary: "重排", source_spans: ["重排：用 Rerank 模型对召回结果重新打分，提升 Top-K 精度。"] }],
      [question("q1", "检索是 RAG 的第一阶段，决定模型能看到什么证据。")],
    );

    expect(report.topicCoverage.find((topic) => topic.topicId === "t2")?.covered).toBe(false);
    expect(coverageSummary(report)).toContain("1 个知识点没有出题");
    expect(coverageSummary(report)).toContain("覆盖 1/4");
  });

  it("简答题的得分点依据也算覆盖", () => {
    const question: GeneratedQuestion = {
      id: "q1",
      topic_id: "t1",
      type: "short_answer",
      stem: "请说明检索阶段。",
      reference_answer: "向量检索做语义召回。",
      rubric_points: [
        {
          point_id: "p1",
          statement: "提到向量检索",
          weight: 1,
          evidence_span: "向量检索：把文本编码成向量，用相似度做语义召回。",
        },
      ],
      difficulty: "medium",
      source_anchor: "检索是 RAG 的第一阶段，决定模型能看到什么证据。",
    };

    const report = verifyCoverage(material, topics, [question]);
    expect(report.coveredCount).toBe(2);
  });
});
