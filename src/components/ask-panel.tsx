"use client";

import { useState } from "react";

type Citation = {
  marker: number;
  unitIndex: number;
  text: string;
  page: number | null;
};

type Issue = {
  kind: string;
  detail: string;
  excerpt?: string;
};

type QaAnswer = {
  question: string;
  answer: string;
  citations: Citation[];
  mode: "llm" | "extractive" | "refused";
  model: string;
  insufficient: boolean;
  issues: Issue[];
  retrievedCount: number;
  citedCount: number;
  termCoverage: number;
  latencyMs: number;
};

const MODE_LABEL: Record<QaAnswer["mode"], string> = {
  llm: "模型回答 · 逐句标注出处",
  extractive: "离线摘录 · 只摘原文不生成",
  refused: "材料里没有",
};

const PRESETS = ["这份材料最核心的结论是什么？", "有哪些容易混淆的概念？", "如果只记三点，该记哪三点？"];

/** 把 [n] 渲染成可点击的引注，点击跳到下面的出处条目。 */
function renderAnswer(text: string) {
  const parts = text.split(/(\[\d+(?:\s*[,，]\s*\d+)*\])/g);
  return parts.map((part, index) => {
    const match = /^\[(\d+(?:\s*[,，]\s*\d+)*)\]$/.exec(part);
    if (!match) return <span key={index}>{part}</span>;
    const markers = match[1].split(/[,，]/).map((value) => Number(value.trim()));
    return (
      <span key={index}>
        {markers.map((marker) => (
          <a key={marker} className="cite" href={`#cite-${marker}`}>
            {marker}
          </a>
        ))}
      </span>
    );
  });
}

export function AskPanel({ materialId }: { materialId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<QaAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function ask(value: string): Promise<void> {
    const text = value.trim();
    if (!text) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/materials/${materialId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const body = (await response.json()) as { answer?: QaAnswer; error?: string };
      if (!response.ok || !body.answer) {
        setError(body.error ?? "回答失败，请稍后重试");
        return;
      }
      setAnswer(body.answer);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const flagged = answer?.issues ?? [];

  return (
    <section className="card">
      <div className="row row--between">
        <h2 style={{ margin: 0 }}>问问 AI（只基于这份材料）</h2>
        {answer ? (
          <span className={`pill${answer.insufficient ? " pill--warn" : ""}`}>
            {MODE_LABEL[answer.mode]}
          </span>
        ) : null}
      </div>
      <p className="muted small">
        检索先在这份材料里找出相关句子，再让模型带着编号回答；引用不合法会被删掉并列出问题，
        材料里没有的内容会标成「模型补充」。
      </p>

      <div className="field">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：向量检索和关键词检索分别解决什么问题？"
          style={{ minHeight: 80 }}
        />
      </div>
      <div className="row row--between">
        <div className="row small muted" style={{ gap: 6, flexWrap: "wrap" }}>
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="pill"
              disabled={pending}
              onClick={() => {
                setQuestion(preset);
                void ask(preset);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <button
          className="btn-primary"
          type="button"
          disabled={pending || question.trim().length === 0}
          onClick={() => void ask(question)}
        >
          {pending ? "检索并回答中…" : "提问"}
        </button>
      </div>

      {error ? <div className="banner banner--err">{error}</div> : null}

      {answer ? (
        <div style={{ marginTop: 16 }}>
          <div className="ask-answer">{renderAnswer(answer.answer)}</div>

          {flagged.length > 0 ? (
            <div className="banner banner--warn">
              <strong>核验提示（{flagged.length} 条）</strong>
              <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {flagged.map((issue, index) => (
                  <li key={`${issue.kind}-${index}`}>
                    {issue.detail}
                    {issue.excerpt ? <em>「{issue.excerpt}」</em> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {answer.citations.length > 0 ? (
            <>
              <h3 style={{ marginTop: 16 }}>出处（材料原文）</h3>
              <ol className="cite-list">
                {answer.citations.map((citation) => (
                  <li key={citation.marker} id={`cite-${citation.marker}`}>
                    <div className="small muted">
                      第 {citation.unitIndex + 1} 句
                      {citation.page ? ` · 第 ${citation.page} 页` : ""}
                    </div>
                    <div>{citation.text}</div>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          <p className="small muted">
            检索到 {answer.retrievedCount} 条相关原文，其中 {answer.citedCount} 条被引用 ·
            问题词命中率 {Math.round(answer.termCoverage * 100)}% · {answer.model} ·{" "}
            {answer.latencyMs} ms
          </p>
        </div>
      ) : null}
    </section>
  );
}
