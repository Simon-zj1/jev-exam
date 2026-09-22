import { describe, expect, it } from "vitest";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { locateAnchor, validateQuestions } from "@/lib/generator/validate";
import { SAMPLE_MATERIAL } from "../helpers";
import type { GeneratedQuestion } from "@/lib/types";

const material = SAMPLE_MATERIAL;

describe("锚点定位", () => {
  it("能找到逐字片段（归一化后）", () => {
    const match = locateAnchor(material, "光反应发生在类囊体薄膜上，需要光照");
    expect(match.found).toBe(true);
    expect(match.matchType).toBe("exact");
  });

  it("对跨行/标点差异仍可模糊定位", () => {
    const match = locateAnchor(material, "光反应发生在类囊体薄膜上 需要光照");
    expect(match.found).toBe(true);
  });

  it("材料中不存在的内容定位失败", () => {
    expect(locateAnchor(material, "线粒体是有氧呼吸的主要场所").found).toBe(false);
  });
});

describe("出题落地校验", () => {
  const topicIds = new Set(["t1"]);

  it("丢弃锚点不存在、结构不合法与重复的题目", () => {
    const candidates: unknown[] = [
      {
        id: "q1",
        topic_id: "t1",
        type: "mcq",
        stem: "以下哪项与材料一致？",
        options: ["甲", "乙", "丙", "丁"],
        correct_index: 1,
        difficulty: "medium",
        source_anchor: "光反应发生在类囊体薄膜上，需要光照",
      },
      {
        id: "q2",
        topic_id: "t1",
        type: "mcq",
        stem: "以下哪项与材料一致？",
        options: ["甲", "乙", "丙", "丁"],
        correct_index: 1,
        difficulty: "medium",
        source_anchor: "光反应发生在类囊体薄膜上，需要光照",
      },
      {
        id: "q3",
        topic_id: "t1",
        type: "true_false",
        stem: "判断：线粒体是光合作用场所。",
        answer: false,
        difficulty: "easy",
        source_anchor: "线粒体是光合作用发生的场所",
      },
      {
        id: "q4",
        topic_id: "t9",
        type: "true_false",
        stem: "判断：暗反应不需要光照。",
        answer: true,
        difficulty: "easy",
        source_anchor: "暗反应发生在叶绿体基质中，不需要光照",
      },
      { id: "q5", topic_id: "t1", type: "mcq", stem: "缺字段" },
    ];

    const { valid, issues } = validateQuestions(candidates, material, topicIds);
    expect(valid).toHaveLength(1);
    expect(valid[0].id).toBe("q1");
    expect(issues.map((issue) => issue.code).sort()).toEqual([
      "anchor_missing",
      "duplicate",
      "schema_invalid",
      "unknown_topic",
    ]);
  });
});

describe("离线出题器", () => {
  it("产出的题目全部通过落地校验", async () => {
    const provider = new HeuristicGenerationProvider();
    const outline = await provider.generateOutline({ materialText: material, topicCount: 3 });
    expect(outline.topics.length).toBeGreaterThan(0);

    const generated = await provider.generateQuestions({
      materialText: material,
      topics: outline.topics,
      mix: { mcq: 3, true_false: 2, cloze: 2, short_answer: 2 },
      count: 9,
    });
    expect(generated.questions.length).toBeGreaterThan(3);

    const { valid, issues } = validateQuestions(
      generated.questions as unknown as GeneratedQuestion[],
      material,
      new Set(outline.topics.map((topic) => topic.id)),
    );
    expect(issues).toHaveLength(0);
    expect(valid.length).toBe(generated.questions.length);
  });

  it("简答题带有 3-6 个带权重的评分点", async () => {
    const provider = new HeuristicGenerationProvider();
    const outline = await provider.generateOutline({ materialText: material, topicCount: 2 });
    const generated = await provider.generateQuestions({
      materialText: material,
      topics: outline.topics,
      mix: { short_answer: 1 },
      count: 1,
    });
    const shortAnswer = generated.questions.find((question) => question.type === "short_answer");
    expect(shortAnswer).toBeDefined();
    if (shortAnswer?.type === "short_answer") {
      expect(shortAnswer.rubric_points.length).toBeGreaterThanOrEqual(3);
      expect(shortAnswer.rubric_points.every((point) => point.weight > 0)).toBe(true);
    }
  });
});
