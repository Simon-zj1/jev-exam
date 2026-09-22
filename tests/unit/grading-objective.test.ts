import { describe, expect, it } from "vitest";
import { clozeMatches, gradeCloze, gradeMcq, gradeTrueFalse, normalizeFillAnswer } from "@/lib/grading";
import { FakeEngine, noul } from "../helpers";
import type { ClozeQuestion, McqQuestion, TrueFalseQuestion } from "@/lib/types";

const mcq: McqQuestion = {
  id: "q1",
  topic_id: "t1",
  type: "mcq",
  stem: "光反应发生在哪里？",
  options: ["类囊体薄膜", "叶绿体基质", "细胞质基质", "线粒体"],
  correct_index: 0,
  difficulty: "easy",
  source_anchor: "光反应发生在类囊体薄膜上",
};

const trueFalse: TrueFalseQuestion = {
  id: "q2",
  topic_id: "t1",
  type: "true_false",
  stem: "判断：暗反应需要光照。",
  answer: false,
  difficulty: "easy",
  source_anchor: "暗反应发生在叶绿体基质中，不需要光照",
};

const cloze: ClozeQuestion = {
  id: "q3",
  topic_id: "t1",
  type: "cloze",
  stem: "请补全材料中的关键表述。",
  text_with_blank: "光合作用分为____和暗反应两个阶段",
  answer: "光反应",
  accepted: ["光反应阶段", "光反应"],
  difficulty: "medium",
  source_anchor: "光合作用分为光反应和暗反应两个阶段",
};

describe("客观题判分", () => {
  it("选择题按选项下标比对", () => {
    expect(gradeMcq(mcq, 0).scorePercent).toBe(100);
    expect(gradeMcq(mcq, 2).scorePercent).toBe(0);
    expect(gradeMcq(mcq, null).scorePercent).toBe(0);
    expect(gradeMcq(mcq, 0).usedEngine).toBe(false);
  });

  it("判断题按布尔值比对", () => {
    expect(gradeTrueFalse(trueFalse, false).scorePercent).toBe(100);
    expect(gradeTrueFalse(trueFalse, true).scorePercent).toBe(0);
  });

  it("填空归一化：大小写、全半角、前后缀与标点", () => {
    expect(normalizeFillAnswer(" ＡＴＰ。")).toBe("atp");
    expect(normalizeFillAnswer("答案：ATP")).toBe("atp");
    expect(clozeMatches(cloze, "光反应")).toBe(true);
    expect(clozeMatches(cloze, "光反应阶段")).toBe(true);
    expect(clozeMatches(cloze, "暗反应")).toBe(false);
    expect(clozeMatches(cloze, "   ")).toBe(false);
  });

  it("填空一致时走确定性判分，不调用引擎", async () => {
    const engine = new FakeEngine(() => ({ equivalent: noul(0.9) }));
    const judgment = await gradeCloze(cloze, "光反应", engine);
    expect(judgment.method).toBe("exact");
    expect(judgment.usedEngine).toBe(false);
    expect(engine.calls).toBe(0);
  });

  it("填空语义等价：高置信接受，低置信标记待复核", async () => {
    const confident = new FakeEngine(() => ({ equivalent: noul(0.93) }));
    const accepted = await gradeCloze(cloze, "光照阶段的反应", confident);
    expect(accepted.method).toBe("semantic");
    expect(accepted.usedEngine).toBe(true);
    expect(accepted.scorePercent).toBe(100);
    expect(accepted.needsReview).toBe(false);

    const uncertain = new FakeEngine(() => ({ equivalent: noul(0.55) }));
    const flagged = await gradeCloze(cloze, "光合", uncertain);
    expect(flagged.needsReview).toBe(true);
    expect(flagged.reviewReasons).toContain("low_confidence_semantic_match");
  });

  it("没有引擎时，字面不一致的填空标记为待复核而不是直接判错", async () => {
    const judgment = await gradeCloze(cloze, "光合作用的第一阶段", null);
    expect(judgment.scorePercent).toBe(0);
    expect(judgment.needsReview).toBe(true);
    expect(judgment.reviewReasons).toContain("semantic_check_unavailable");
  });
});
