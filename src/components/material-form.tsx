"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SAMPLE = `检索是 RAG 的第一阶段，决定模型能看到什么证据。
向量检索：把文本编码成向量，用相似度做语义召回。
关键词检索：用 BM25 之类的算法补足专有名词与精确匹配。
重排：用 Rerank 模型对召回结果重新打分，提升 Top-K 精度。
分块：块太大引入噪声，太小割裂语义，通常按语义边界切分并保留重叠。
Agent：由模型驱动、可以调用工具并根据结果继续行动的循环系统。
ReAct：把推理与行动交替进行，观察工具结果后再决定下一步。
工具调用：把外部能力以函数签名暴露给模型，模型输出结构化参数，由代码执行并回传。
记忆：短期记忆放在对话上下文，长期记忆落到向量库，按相关性检索后再注入。
规划：把复杂目标拆成子任务，配合执行后的反思，而不是一次性长篇推理。
评测：离线用标注集，线上看人工反馈与失败案例回流，没有评测就没有迭代依据。
幻觉：模型生成与事实不符的内容，可用检索约束、工具校验和置信度门控缓解。
微调与 RAG：RAG 改知识，微调改行为与格式，二者解决的不是同一个问题。
上下文工程：控制进入模型的信息量与顺序，稳定规则在前，易变内容在后。`;

export function MaterialForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch("/api/materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, rawText }),
          });
          const payload = (await response.json()) as { material?: { id: string }; error?: string };
          if (!response.ok || !payload.material) {
            setError(payload.error ?? "上传失败");
            return;
          }
          router.push(`/materials/${payload.material.id}`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="title">材料标题</label>
        <input
          id="title"
          type="text"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：生物必修一 · 光合作用"
        />
      </div>
      <div className="field">
        <label htmlFor="rawText">粘贴学习材料（纯文本 / Markdown，至少 80 字）</label>
        <textarea
          id="rawText"
          required
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder="把要考的原文粘进来，出题与评分点都会严格基于这段材料。"
        />
        <div className="row row--between small muted" style={{ marginTop: 6 }}>
          <span>{rawText.length} 字符</span>
          <button type="button" onClick={() => setRawText(SAMPLE)}>
            填入示例材料
          </button>
        </div>
      </div>
      {error ? <div className="banner banner--err">{error}</div> : null}
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存材料"}
      </button>
    </form>
  );
}
