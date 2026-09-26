import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginWithInvite } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { setChatProviderOverride } from "@/lib/llm/provider";
import { askMaterialQuestion } from "@/lib/services/qa";
import { createMaterialForUser } from "@/lib/services/materials";
import { usageSnapshot } from "@/lib/quota";
import { FakeChatProvider, resetOverrides, useMemoryStore } from "../helpers";

const MATERIAL = [
  "检索是 RAG 的第一阶段，决定模型能看到什么证据。",
  "向量检索把文本编码成向量，用相似度做语义召回，能覆盖同义改写但容易漏掉专有名词。",
  "关键词检索用 BM25 之类的算法补足专有名词与精确匹配，但无法理解语义。",
  "重排用 Rerank 模型对召回结果重新打分，把最相关的证据排到 Top-K 前面。",
  "分块策略决定检索粒度：块太大引入噪声，太小割裂语义，通常按语义边界切分并保留重叠。",
  "生成阶段必须把引用一并交给模型，并在提示词中要求只用给定证据作答。",
  "评估阶段同时看召回率与忠实度：召回率低说明证据没进来，忠实度低说明模型在编。",
].join("\n");

async function setup() {
  const store = useMemoryStore();
  await store.upsertInviteCode("ASK-CODE", 10);
  const user = (await loginWithInvite("asker@example.com", "ASK-CODE")).user;
  const material = await createMaterialForUser(user, { title: "RAG 笔记", rawText: MATERIAL });
  return { store, user, material };
}

describe("材料问答", () => {
  beforeEach(() => {
    useMemoryStore();
  });
  afterEach(() => resetOverrides());

  it("材料里没有相关内容时如实拒绝，且不调用模型", async () => {
    const { user, material } = await setup();
    const provider = new FakeChatProvider(() => "不应该被调用");
    setChatProviderOverride(provider);

    const answer = await askMaterialQuestion(user, material.id, "请证明黎曼猜想");

    expect(answer.mode).toBe("refused");
    expect(answer.insufficient).toBe(true);
    expect(answer.citations).toHaveLength(0);
    expect(answer.answer).toContain("材料里没有");
    expect(provider.calls).toHaveLength(0);
    // 拒绝路径不消耗额度
    expect((await usageSnapshot(user.id)).ask).toBe(0);
  });

  it("没有可用模型时降级为离线摘录，只给原文并带上出处", async () => {
    const { user, material } = await setup();
    // 不注入任何 provider：等价于线上没有配置对话模型
    const answer = await askMaterialQuestion(user, material.id, "向量检索和关键词检索分别解决什么问题？");

    expect(answer.mode).toBe("extractive");
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations.every((citation) => MATERIAL.includes(citation.text))).toBe(true);
    expect(answer.termCoverage).toBeGreaterThan(0);
  });

  it("模型回答会被逐条校验：越界编号删掉、无出处句子列出、模型补充单独标注", async () => {
    const { user, material } = await setup();
    setChatProviderOverride(
      new FakeChatProvider(
        () =>
          [
            "向量检索把文本编码成向量，用相似度做语义召回[1]。",
            "关键词检索补足专有名词与精确匹配[2]。",
            "这两者组合起来一定比其他方案都好，而且成本更低。",
            "【模型补充】实际系统里常用混合检索再加重排。",
            "另外还可以参考[9]。",
          ].join("\n"),
      ),
    );

    const answer = await askMaterialQuestion(user, material.id, "向量检索和关键词检索的区别？");

    expect(answer.mode).toBe("llm");
    expect(answer.citations.map((citation) => citation.marker)).toEqual([1, 2]);
    // 引用的原文必须逐字出现在材料里
    for (const citation of answer.citations) {
      expect(MATERIAL).toContain(citation.text);
    }
    // 越界编号已从正文移除
    expect(answer.answer).not.toContain("[9]");

    const kinds = answer.issues.map((issue) => issue.kind);
    expect(kinds).toContain("unknown_citation");
    expect(kinds).toContain("uncited_sentence");
    expect(kinds).toContain("model_supplement");
    const uncited = answer.issues.find((issue) => issue.kind === "uncited_sentence");
    expect(uncited?.excerpt).toContain("组合起来");
  });

  it("走平台模型时计入 ask 额度", async () => {
    const { user, material } = await setup();
    setChatProviderOverride(
      new FakeChatProvider(() => "向量检索用相似度做语义召回[1]。"),
      { countsAgainstQuota: true },
    );

    await askMaterialQuestion(user, material.id, "向量检索是怎么做的？");
    expect((await usageSnapshot(user.id)).ask).toBe(1);
  });

  it("问题为空或过长会被拒绝", async () => {
    const { user, material } = await setup();
    await expect(askMaterialQuestion(user, material.id, "   ")).rejects.toThrow("请先输入问题");
    await expect(askMaterialQuestion(user, material.id, "问".repeat(500))).rejects.toThrow("问题太长");
  });

  it("别人的材料读不到", async () => {
    const { material } = await setup();
    const store = getStore();
    const intruder = (await loginWithInvite("intruder-qa@example.com", "ASK-CODE")).user;
    expect(store).toBeDefined();
    await expect(askMaterialQuestion(intruder, material.id, "这是什么？")).rejects.toThrow();
  });
});
