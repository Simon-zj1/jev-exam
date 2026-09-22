import { describe, expect, it } from "vitest";
import { estimateTokens, normalizeText, similarity } from "@/lib/text";

describe("文本归一化", () => {
  it("归一化大小写、全半角与标点", () => {
    expect(normalizeText("ＡＴＰ。")).toBe("atp");
    expect(normalizeText("Cell  Respiration!")).toBe("cellrespiration");
    expect(normalizeText("光合作用， 是 什么？")).toBe("光合作用是什么");
  });

  it("相似度对同义改写敏感、对无关文本不敏感", () => {
    const base = "光反应发生在类囊体薄膜上，需要光照";
    expect(similarity(base, "光反应发生在类囊体薄膜上")).toBeGreaterThan(0.5);
    expect(similarity(base, "暗反应发生在叶绿体基质中")).toBeLessThan(0.3);
  });

  it("token 估算对中文更保守", () => {
    expect(estimateTokens("光合作用")).toBe(4);
    expect(estimateTokens("photosynthesis")).toBe(4);
  });
});
