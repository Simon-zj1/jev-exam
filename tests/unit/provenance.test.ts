import { describe, expect, it } from "vitest";
import { locateSource, verifyProvenance } from "@/lib/provenance";
import type { GeneratedQuestion } from "@/lib/types";

const material = "检索是 RAG 的第一阶段，决定模型能看到什么证据。\n向量检索：把文本编码成向量，用相似度做语义召回。";

describe("溯源契约", () => {
  it("材料事实字段缺失或无法定位时记为违规", () => {
    const questions: GeneratedQuestion[] = [
      {
        id: "q1",
        topic_id: "t1",
        type: "true_false",
        stem: "判断：检索决定模型能看到什么证据。",
        answer: true,
        difficulty: "easy",
        source_anchor: "检索是 RAG 的第一阶段，决定模型能看到什么证据。",
      },
      {
        id: "q2",
        topic_id: "t1",
        type: "true_false",
        stem: "判断：不存在的说法。",
        answer: false,
        difficulty: "easy",
        source_anchor: "这句话在材料里根本不存在。",
      },
      {
        id: "q3",
        topic_id: "t1",
        type: "short_answer",
        stem: "请说明向量检索。",
        reference_answer: "把文本编码成向量。",
        rubric_points: [
          {
            point_id: "p1",
            statement: "提到向量检索",
            weight: 1,
            evidence_span: "向量检索：把文本编码成向量，用相似度做语义召回。",
          },
          { point_id: "p2", statement: "编造的要点", weight: 1, evidence_span: "材料里没有这句依据。" },
        ],
        difficulty: "medium",
        source_anchor: "向量检索：把文本编码成向量，用相似度做语义召回。",
      },
    ];

    const violations = verifyProvenance(material, questions);
    expect(violations.map((violation) => `${violation.questionId}:${violation.field}`)).toEqual([
      "q2:source_anchor",
      "q3:rubric_point.p2.evidence_span",
    ]);
  });

  it("全部材料字段可定位时没有违规", () => {
    const questions: GeneratedQuestion[] = [
      {
        id: "q1",
        topic_id: "t1",
        type: "cloze",
        stem: "请补全材料中的关键表述。",
        text_with_blank: "____是 RAG 的第一阶段",
        answer: "检索",
        accepted: ["检索"],
        difficulty: "easy",
        source_anchor: "检索是 RAG 的第一阶段，决定模型能看到什么证据。",
      },
    ];
    expect(verifyProvenance(material, questions)).toHaveLength(0);
  });

  it("出处定位给出句子单位与总句数", () => {
    const location = locateSource(material, "向量检索：把文本编码成向量，用相似度做语义召回。");
    expect(location.found).toBe(true);
    expect(location.unitIndex).toBe(1);
    expect(location.unitCount).toBe(2);

    const missing = locateSource(material, "材料里没有这句。");
    expect(missing.found).toBe(false);
    expect(missing.unitIndex).toBeNull();
  });
});
