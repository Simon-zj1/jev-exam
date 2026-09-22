"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Topic } from "@/lib/types";
import type { QuestionType } from "@/lib/config";

const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "单项选择",
  true_false: "判断题",
  cloze: "填空题",
  short_answer: "简答题",
};

export function ExamBuilder({
  materialId,
  topics,
  defaultCount,
  maxCount,
  minCount,
  defaultMix,
}: {
  materialId: string;
  topics: Topic[];
  defaultCount: number;
  maxCount: number;
  minCount: number;
  defaultMix: Record<QuestionType, number>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(topics.map((topic) => topic.id));
  const [count, setCount] = useState(defaultCount);
  const [mix, setMix] = useState<Record<QuestionType, number>>(defaultMix);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mixTotal = useMemo(
    () => Object.values(mix).reduce((sum, value) => sum + value, 0),
    [mix],
  );

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch("/api/exams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ materialId, topicIds: selected, count, mix }),
          });
          const payload = (await response.json()) as { examId?: string; error?: string };
          if (!response.ok || !payload.examId) {
            setError(payload.error ?? "生成试卷失败");
            return;
          }
          router.push(`/exams/${payload.examId}/take`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <h3>1. 选择知识点</h3>
      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        {topics.map((topic) => {
          const checked = selected.includes(topic.id);
          return (
            <label key={topic.id} className={`option${checked ? " option--selected" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setSelected((current) =>
                    current.includes(topic.id)
                      ? current.filter((id) => id !== topic.id)
                      : [...current, topic.id],
                  )
                }
              />
              <span>
                <strong>{topic.title}</strong>
                <span className="small muted" style={{ display: "block" }}>
                  {topic.summary}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <h3>2. 题量与题型配比</h3>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="count">题目数量（{minCount}–{maxCount}）</label>
        <input
          id="count"
          type="number"
          min={minCount}
          max={maxCount}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
      </div>
      <div className="grid grid--3">
        {(Object.keys(mix) as QuestionType[]).map((type) => (
          <div className="field" key={type}>
            <label htmlFor={`mix-${type}`}>
              {TYPE_LABEL[type]} 权重（当前 {Math.round((mix[type] / (mixTotal || 1)) * 100)}%）
            </label>
            <input
              id={`mix-${type}`}
              type="number"
              min={0}
              max={10}
              step={1}
              value={mix[type]}
              onChange={(event) =>
                setMix((current) => ({ ...current, [type]: Number(event.target.value) }))
              }
            />
          </div>
        ))}
      </div>

      {error ? <div className="banner banner--err">{error}</div> : null}
      <button
        className="btn-primary"
        type="submit"
        disabled={pending || selected.length === 0}
      >
        {pending ? "正在出题…" : "生成试卷并开始作答"}
      </button>
    </form>
  );
}
