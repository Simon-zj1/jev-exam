"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnswerPayload } from "@/lib/grading";

export type RunnerQuestion = {
  id: string;
  type: "mcq" | "true_false" | "cloze" | "short_answer";
  stem: string;
  options: string[] | null;
  topicTitle: string;
  difficulty: string;
  draft: AnswerPayload | null;
};

type DraftState = Record<string, AnswerPayload>;

const TYPE_LABEL: Record<RunnerQuestion["type"], string> = {
  mcq: "单项选择",
  true_false: "判断题",
  cloze: "填空题",
  short_answer: "简答题",
};

export function ExamRunner({
  examId,
  questions,
}: {
  examId: string;
  questions: RunnerQuestion[];
}) {
  const router = useRouter();
  const storageKey = `jev-exam-draft-${examId}`;
  const initial = useMemo<DraftState>(() => {
    const draft: DraftState = {};
    for (const question of questions) {
      if (question.draft) draft[question.id] = question.draft;
    }
    return draft;
  }, [questions]);

  const [answers, setAnswers] = useState<DraftState>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as DraftState;
        setAnswers((current) => ({ ...parsed, ...current }));
      }
    } catch {
      // 忽略损坏的本地草稿
    }
  }, [storageKey]);

  const update = useCallback(
    (questionId: string, payload: AnswerPayload) => {
      setAnswers((current) => {
        const next = { ...current, [questionId]: payload };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
          setSavedAt(new Date().toLocaleTimeString("zh-CN"));
        } catch {
          // localStorage 不可用时静默降级
        }
        return next;
      });
    },
    [storageKey],
  );

  const answeredCount = Object.values(answers).filter((payload) => {
    if (payload.type === "mcq") return payload.index !== null;
    if (payload.type === "true_false") return payload.value !== null;
    return payload.text.trim().length > 0;
  }).length;

  return (
    <div>
      <div className="card card--flat">
        <div className="row row--between">
          <span className="small muted">
            已作答 {answeredCount} / {questions.length}
            {savedAt ? ` · 草稿已自动保存（${savedAt}）` : ""}
          </span>
          <span className="small muted">提交后由判定引擎逐题判分，低置信度题目会标记为待复核。</span>
        </div>
      </div>

      {questions.map((question, index) => (
        <div className="question" key={question.id}>
          <div className="question__head">
            <span className="question__index">{index + 1}</span>
            <span className="pill">{TYPE_LABEL[question.type]}</span>
            <span className="small muted">{question.topicTitle}</span>
          </div>
          <p style={{ marginBottom: 6 }}>{question.stem}</p>

          {question.type === "mcq" ? (
            <div className="options">
              {(question.options ?? []).map((option, optionIndex) => {
                const selected =
                  answers[question.id]?.type === "mcq" &&
                  (answers[question.id] as { index: number | null }).index === optionIndex;
                return (
                  <label
                    key={option}
                    className={`option${selected ? " option--selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      checked={selected}
                      onChange={() => update(question.id, { type: "mcq", index: optionIndex })}
                    />
                    <span>
                      {String.fromCharCode(65 + optionIndex)}. {option}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {question.type === "true_false" ? (
            <div className="options">
              {[true, false].map((value) => {
                const selected =
                  answers[question.id]?.type === "true_false" &&
                  (answers[question.id] as { value: boolean | null }).value === value;
                return (
                  <label
                    key={String(value)}
                    className={`option${selected ? " option--selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      checked={selected}
                      onChange={() => update(question.id, { type: "true_false", value })}
                    />
                    <span>{value ? "正确" : "错误"}</span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {question.type === "cloze" ? (
            <input
              type="text"
              value={
                answers[question.id]?.type === "cloze"
                  ? (answers[question.id] as { text: string }).text
                  : ""
              }
              placeholder="填写空位内容"
              onChange={(event) => update(question.id, { type: "cloze", text: event.target.value })}
            />
          ) : null}

          {question.type === "short_answer" ? (
            <textarea
              style={{ minHeight: 140 }}
              value={
                answers[question.id]?.type === "short_answer"
                  ? (answers[question.id] as { text: string }).text
                  : ""
              }
              placeholder="按要点作答，判定会逐个得分点检查是否覆盖。"
              onChange={(event) =>
                update(question.id, { type: "short_answer", text: event.target.value })
              }
            />
          ) : null}
        </div>
      ))}

      {error ? <div className="banner banner--err">{error}</div> : null}

      <div className="card card--flat row row--between no-print">
        <span className="small muted">提交即生成判定报告。</span>
        <button
          className="btn-primary"
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              const response = await fetch(`/api/exams/${examId}/submit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  answers: questions.map((question) => ({
                    questionId: question.id,
                    payload: answers[question.id] ?? null,
                  })),
                }),
              });
              const payload = (await response.json()) as { attemptId?: string; error?: string };
              if (!response.ok || !payload.attemptId) {
                setError(payload.error ?? "提交失败");
                return;
              }
              window.localStorage.removeItem(storageKey);
              router.push(`/attempts/${payload.attemptId}`);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "判定中…" : "提交并查看判定结果"}
        </button>
      </div>
    </div>
  );
}
