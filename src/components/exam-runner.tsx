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

type JudgeState = {
  status: "idle" | "judging" | "done" | "error";
  scorePercent?: number;
  needsReview?: boolean;
  points?: number;
  message?: string;
};

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
  const [progress, setProgress] = useState<Record<string, JudgeState>>({});
  const [judging, setJudging] = useState(false);

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

  const judgedCount = Object.values(progress).filter((entry) => entry.status === "done").length;
  const needsReviewCount = Object.values(progress).filter((entry) => entry.needsReview).length;
  const averageScorePercent = (() => {
    const scored = Object.values(progress).filter(
      (entry) => entry.status === "done" && entry.scorePercent !== undefined,
    );
    if (scored.length === 0) return null;
    return Math.round(
      scored.reduce((sum, entry) => sum + (entry.scorePercent ?? 0), 0) / scored.length,
    );
  })();

  async function judgeQuestion(question: RunnerQuestion): Promise<void> {
    setProgress((current) => ({ ...current, [question.id]: { status: "judging" } }));
    try {
      const response = await fetch(`/api/exams/${examId}/judge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, payload: answers[question.id] ?? null }),
      });
      const payload = (await response.json()) as {
        scorePercent?: number;
        needsReview?: boolean;
        points?: unknown[];
        error?: string;
      };
      if (!response.ok) {
        setProgress((current) => ({
          ...current,
          [question.id]: { status: "error", message: payload.error ?? "判定失败" },
        }));
        return;
      }
      setProgress((current) => ({
        ...current,
        [question.id]: {
          status: "done",
          scorePercent: payload.scorePercent ?? 0,
          needsReview: payload.needsReview ?? false,
          points: payload.points?.length ?? 0,
        },
      }));
    } catch (err) {
      setProgress((current) => ({
        ...current,
        [question.id]: { status: "error", message: (err as Error).message },
      }));
    }
  }

  /** 并发判定，但限制在 4 路，避免一次打满上游。 */
  async function judgeAll(): Promise<void> {
    const queue = [...questions];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0) {
        const question = queue.shift();
        if (!question) return;
        await judgeQuestion(question);
      }
    });
    await Promise.all(workers);
  }

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

      {judging || judgedCount > 0 ? (
        <div className="card card--flat">
          <div className="row row--between">
            <span className="small">
              判定进度 {judgedCount} / {questions.length}
              {needsReviewCount > 0 ? ` · ${needsReviewCount} 题待复核` : ""}
              {averageScorePercent !== null ? ` · 当前均分 ${averageScorePercent}` : ""}
            </span>
            <span className="small muted">
              客观题走确定性判分，主观题每个得分点一次判定（并行发出）
            </span>
          </div>
          <div className="meter" style={{ marginTop: 10 }}>
            <div
              className="meter__fill"
              style={{ width: `${Math.round((judgedCount / questions.length) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {questions.map((question, index) => (
        <div className="question" key={question.id}>
          <div className="question__head">
            <span className="question__index">{index + 1}</span>
            <span className="pill">{TYPE_LABEL[question.type]}</span>
            <span className="small muted">{question.topicTitle}</span>
            {progress[question.id]?.status === "judging" ? (
              <span className="pill">判定中…</span>
            ) : null}
            {progress[question.id]?.status === "done" ? (
              progress[question.id]?.needsReview ? (
                <span className="pill pill--warn">待复核</span>
              ) : (
                <span
                  className={`pill ${
                    (progress[question.id]?.scorePercent ?? 0) >= 60 ? "pill--ok" : "pill--err"
                  }`}
                >
                  {progress[question.id]?.scorePercent} 分
                </span>
              )
            ) : null}
            {progress[question.id]?.status === "error" ? (
              <span className="pill pill--err">{progress[question.id]?.message ?? "判定失败"}</span>
            ) : null}
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
        <span className="small muted">
          提交后逐题判定并实时显示结果，全部完成后收卷生成报告。
        </span>
        <button
          className="btn-primary"
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              window.localStorage.setItem(storageKey, JSON.stringify(answers));
              setJudging(true);
              await judgeAll();

              const response = await fetch(`/api/exams/${examId}/finalize`, { method: "POST" });
              const payload = (await response.json()) as { attemptId?: string; error?: string };
              if (!response.ok || !payload.attemptId) {
                setError(payload.error ?? "收卷失败");
                return;
              }
              window.localStorage.removeItem(storageKey);
              router.push(`/attempts/${payload.attemptId}`);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setJudging(false);
              setPending(false);
            }
          }}
        >
          {pending ? (judging ? "判定中…" : "收卷中…") : "提交并逐题判定"}
        </button>
      </div>
    </div>
  );
}
