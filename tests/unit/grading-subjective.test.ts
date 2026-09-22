import { describe, expect, it } from "vitest";
import { buildRubricQuestions, gradeShortAnswer } from "@/lib/grading";
import { FakeEngine, noul } from "../helpers";
import type { DecisionAnswer, ShortAnswerQuestion } from "@/lib/types";

const question: ShortAnswerQuestion = {
  id: "q1",
  topic_id: "t1",
  type: "short_answer",
  stem: "请说明光反应与暗反应的区别。",
  reference_answer: "光反应在类囊体薄膜上、需要光照、产生氧气和ATP；暗反应在叶绿体基质中、不需要光照。",
  rubric_points: [
    {
      point_id: "p1",
      statement: "指出光反应发生在类囊体薄膜上",
      weight: 1,
      evidence_span: "光反应发生在类囊体薄膜上",
    },
    {
      point_id: "p2",
      statement: "指出暗反应不需要光照",
      weight: 1,
      evidence_span: "暗反应发生在叶绿体基质中，不需要光照",
    },
    {
      point_id: "p3",
      statement: "指出暗反应发生在叶绿体基质中",
      weight: 1,
      evidence_span: "暗反应发生在叶绿体基质中",
    },
  ],
  difficulty: "medium",
  source_anchor: "光合作用分为光反应和暗反应两个阶段",
};

function fullEngine(p1: number, p2: number, p3: number, extra: Record<string, DecisionAnswer> = {}) {
  return new FakeEngine(() => ({
    point_p1: noul(p1),
    point_p2: noul(p2),
    point_p3: noul(p3),
    contradicts: noul(0.02),
    fabricates: noul(0.02),
    ...extra,
  }));
}

describe("要点式主观题判定", () => {
  it("每个得分点的问题自带它要判的那一点，不共享同一段指令", () => {
    const questions = buildRubricQuestions(question, "材料片段");
    const statements = question.rubric_points.map((point) => {
      const built = questions[`point_${point.point_id}`];
      if (built.type !== "noul") throw new Error("rubric 问题必须是 noul");
      return (built.instructions as { point: { statement: string } }).point.statement;
    });

    expect(statements).toEqual(question.rubric_points.map((point) => point.statement));
    // 三个问题不应完全相同，否则模型无法区分自己在判哪一点
    const serialized = question.rubric_points.map(
      (point) => JSON.stringify(questions[`point_${point.point_id}`]),
    );
    expect(new Set(serialized).size).toBe(3);
  });

  it("按权重合成得分，并在全部确定时给出稳定分数", async () => {
    const engine = fullEngine(0.95, 0.9, 0.1);
    const judgment = await gradeShortAnswer({
      question,
      answerText: "光反应在类囊体薄膜上进行，暗反应不需要光。",
      engine,
    });

    expect(judgment.method).toBe("rubric");
    expect(judgment.usedEngine).toBe(true);
    expect(judgment.points).toHaveLength(3);
    // (0.95 + 0.9 + 0.1) / 3 ≈ 0.65，减去极小扣分
    expect(judgment.scorePercent).toBeGreaterThanOrEqual(63);
    expect(judgment.scorePercent).toBeLessThanOrEqual(67);
    expect(judgment.needsReview).toBe(false);
    expect(engine.calls).toBe(1);
  });

  it("关键得分点判定强度不足时整题待复核，并给出分数区间", async () => {
    const engine = fullEngine(0.95, 0.5, 0.9);
    const judgment = await gradeShortAnswer({ question, answerText: "……", engine });

    expect(judgment.needsReview).toBe(true);
    expect(judgment.reviewReasons).toContain("low_confidence_point:p2");
    expect(judgment.scoreRange).toBeDefined();
    if (judgment.scoreRange) {
      expect(judgment.scoreRange[0]).toBeLessThan(judgment.scoreRange[1]);
      expect(judgment.scoreRange[0]).toBeLessThanOrEqual(judgment.score);
      expect(judgment.scoreRange[1]).toBeGreaterThanOrEqual(judgment.score);
    }
  });

  it("矛盾与编造由代码侧扣分", async () => {
    const engine = fullEngine(0.9, 0.9, 0.9, {
      contradicts: noul(0.8),
      fabricates: noul(0.7),
    });
    const judgment = await gradeShortAnswer({ question, answerText: "……", engine });

    expect(judgment.penalties.map((penalty) => penalty.kind).sort()).toEqual([
      "contradiction",
      "fabrication",
    ]);
    // 0.9 - (0.3*0.8 + 0.3*0.7) = 0.45
    expect(judgment.scorePercent).toBeGreaterThanOrEqual(43);
    expect(judgment.scorePercent).toBeLessThanOrEqual(47);
  });

  it("矛盾检查本身不确定时也进入待复核", async () => {
    const engine = fullEngine(0.9, 0.9, 0.9, { contradicts: noul(0.5) });
    const judgment = await gradeShortAnswer({ question, answerText: "……", engine });
    expect(judgment.needsReview).toBe(true);
    expect(judgment.reviewReasons).toContain("low_confidence_contradiction_check");
  });
});
