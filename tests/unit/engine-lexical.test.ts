import { describe, expect, it } from "vitest";
import { LexicalJudgeEngine } from "@/lib/engine/lexical";
import { buildRubricQuestions } from "@/lib/grading";
import type { ShortAnswerQuestion } from "@/lib/types";

const question: ShortAnswerQuestion = {
  id: "q1",
  topic_id: "t1",
  type: "short_answer",
  stem: "请说明光反应与暗反应的区别。",
  reference_answer: "光反应在类囊体薄膜上、需要光照；暗反应在叶绿体基质中、不需要光照。",
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
  ],
  difficulty: "medium",
  source_anchor: "光合作用分为光反应和暗反应两个阶段",
};

const materialExcerpt = "光反应发生在类囊体薄膜上，需要光照。暗反应发生在叶绿体基质中，不需要光照。";

function stateFor(answerText: string) {
  return {
    question: { stem: question.stem },
    rubric: {
      points: question.rubric_points,
      reference_answer: question.reference_answer,
    },
    material: { excerpt: materialExcerpt },
    answer: { text: answerText },
  };
}

describe("离线演示判定引擎（lexical-demo）", () => {
  it("作答覆盖某得分点时给出高概率，未覆盖时给出低概率", async () => {
    const engine = new LexicalJudgeEngine();
    const questions = buildRubricQuestions(question, materialExcerpt);
    const result = await engine.decide(
      stateFor("光反应发生在类囊体薄膜上进行，并且需要光照。"),
      questions,
    );

    const covered = result.answers.point_p1;
    const missing = result.answers.point_p2;
    if (covered.type !== "noul" || missing.type !== "noul") throw new Error("应为 noul 答案");

    expect(covered.noul).toBeGreaterThan(0.6);
    expect(missing.noul).toBeLessThan(0.4);
    expect(covered.noul).toBeGreaterThan(missing.noul);
  });

  it("矛盾与编造检查返回稳定的低概率（演示引擎不做这类检测）", async () => {
    const engine = new LexicalJudgeEngine();
    const questions = buildRubricQuestions(question, materialExcerpt);
    const result = await engine.decide(stateFor("完全不相关的一段话。"), questions);

    expect(result.answers.contradicts).toEqual({ type: "noul", noul: 0.05 });
    expect(result.answers.fabricates).toEqual({ type: "noul", noul: 0.05 });
  });

  it("填空题语义等价问题能读到参考答案", async () => {
    const engine = new LexicalJudgeEngine();
    const result = await engine.decide(
      {
        question: { stem: "补全", text_with_blank: "光反应发生在____上" },
        reference: { answer: "类囊体薄膜", accepted: ["类囊体膜"] },
        student_answer: { text: "类囊体薄膜" },
      },
      {
        equivalent: {
          type: "noul",
          instructions: {
            question: "`student_answer.text` 与 `reference.answer` 是否语义等价？",
            inspect: "`student_answer.text`",
            reference: "`reference`",
          },
        },
      },
    );

    const answer = result.answers.equivalent;
    if (answer.type !== "noul") throw new Error("应为 noul 答案");
    expect(answer.noul).toBeGreaterThan(0.6);
  });
});
