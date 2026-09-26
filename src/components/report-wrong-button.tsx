"use client";

import { useState } from "react";

const KINDS = [
  { value: "wrong_score", label: "判定分数不对" },
  { value: "wrong_reference", label: "参考答案不对" },
  { value: "bad_question", label: "题目本身有问题" },
  { value: "other", label: "其它问题" },
];

/**
 * 结果页的「这题判错了」入口。
 *
 * 教育产品对判错的容忍度极低：只要用户觉得判错又没有出口，信任就没了。
 * 同时这条反馈会被冻结成快照，人工确认后可以直接进金标准集。
 */
export function ReportWrongButton({
  questionId,
  attemptId,
}: {
  questionId: string;
  attemptId: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(KINDS[0].value);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, attemptId, kind, note }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "提交失败，请稍后再试");
        return;
      }
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return <span className="small muted">已收到，我们会人工复核这道题。</span>;
  }

  return (
    <div className="small">
      {open ? (
        <div className="card card--flat" style={{ marginTop: 10, padding: 12 }}>
          <div className="field">
            <label htmlFor={`feedback-kind-${questionId}`}>问题类型</label>
            <select
              id={`feedback-kind-${questionId}`}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`feedback-note-${questionId}`}>补充说明（可留空）</label>
            <textarea
              id={`feedback-note-${questionId}`}
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：我答到了「按语义边界切分」，但这一条被判成未命中。"
              style={{ minHeight: 80 }}
            />
          </div>
          {error ? <div className="banner banner--err">{error}</div> : null}
          <div className="row">
            <button className="btn-primary" type="button" disabled={pending} onClick={() => void submit()}>
              {pending ? "提交中…" : "提交"}
            </button>
            <button type="button" disabled={pending} onClick={() => setOpen(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          这题判错了？
        </button>
      )}
    </div>
  );
}
