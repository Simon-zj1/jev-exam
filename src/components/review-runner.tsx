"use client";

import Link from "next/link";
import { useState } from "react";
import { RATING_LABEL, type ReviewRating } from "@/lib/fsrs";
import type { AnswerPayload } from "@/lib/grading";

export type ReviewCardView = {
  questionId: string;
  type: "mcq" | "true_false" | "cloze" | "short_answer";
  stem: string;
  options: string[] | null;
  topicTitle: string;
  state: string;
  reps: number;
  lapses: number;
  overdueDays: number;
  lastScorePercent: number | null;
};

type GradeResult = {
  mode: "judged" | "self-report";
  scorePercent?: number;
  needsReview?: boolean;
  reviewReasons?: string[];
  rating: ReviewRating;
  intervalLabel: string;
  scheduledDays?: number;
  nextDueAt: string;
  points?: { point_id: string; statement: string; probability: number; awarded: boolean }[];
};

const TYPE_LABEL: Record<ReviewCardView["type"], string> = {
  mcq: "单项选择",
  true_false: "判断",
  cloze: "填空",
  short_answer: "简答",
};

/** 复习一次只处理一张卡片：作答 → 判定 → 显示下次复习时间 → 下一张 */
export function ReviewRunner({ cards }: { cards: ReviewCardView[] }) {
  const [index, setIndex] = useState(0);
  const [payload, setPayload] = useState<AnswerPayload | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graded, setGraded] = useState(0);

  if (cards.length === 0) return null;

  if (index >= cards.length) {
    return (
      <div className="card">
        <h2>今天的复习完成了 🎉</h2>
        <p className="muted small">
          本次复习了 {cards.length} 张卡片。每张卡片都按你的判定结果重新排期：
          答得越稳，下次间隔越长；答错会当天再来。
        </p>
        <div className="row">
          <Link className="pill" href="/">
            回首页
          </Link>
          <Link className="pill" href="/mistakes">
            看错题本
          </Link>
        </div>
      </div>
    );
  }

  const card = cards[index];

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: card.questionId, payload }),
      });
      const body = (await response.json()) as GradeResult & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "判定失败");
        return;
      }
      setResult(body);
      setGraded((value) => value + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  function next(): void {
    setResult(null);
    setPayload(null);
    setIndex((value) => value + 1);
  }

  return (
    <div>
      <div className="card card--flat">
        <div className="row row--between">
          <span className="small muted">
            第 {index + 1} / {cards.length} 张 · 已完成 {graded} 张
          </span>
          <span className="small muted">
            {card.topicTitle} · 已复习 {card.reps} 次
            {card.lapses > 0 ? ` · 遗忘 ${card.lapses} 次` : ""}
            {card.overdueDays > 0 ? ` · 逾期 ${card.overdueDays} 天` : ""}
          </span>
        </div>
        <div className="meter" style={{ marginTop: 10 }}>
          <div
            className="meter__fill"
            style={{ width: `${Math.round((index / cards.length) * 100)}%` }}
          />
        </div>
      </div>

      <div className="question">
        <div className="question__head">
          <span className="pill">{TYPE_LABEL[card.type]}</span>
          {card.lastScorePercent !== null ? (
            <span className="pill pill--warn">上次 {card.lastScorePercent} 分</span>
          ) : null}
        </div>
        <p style={{ marginBottom: 10 }}>{card.stem}</p>

        {card.type === "mcq" ? (
          <div className="options">
            {(card.options ?? []).map((option, optionIndex) => {
              const selected =
                payload?.type === "mcq" && (payload as { index: number | null }).index === optionIndex;
              return (
                <label key={option} className={`option${selected ? " option--selected" : ""}`}>
                  <input
                    type="radio"
                    name={card.questionId}
                    checked={selected}
                    onChange={() => setPayload({ type: "mcq", index: optionIndex })}
                  />
                  <span>
                    {String.fromCharCode(65 + optionIndex)}. {option}
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}

        {card.type === "true_false" ? (
          <div className="options">
            {[true, false].map((value) => {
              const selected =
                payload?.type === "true_false" &&
                (payload as { value: boolean | null }).value === value;
              return (
                <label key={String(value)} className={`option${selected ? " option--selected" : ""}`}>
                  <input
                    type="radio"
                    name={card.questionId}
                    checked={selected}
                    onChange={() => setPayload({ type: "true_false", value })}
                  />
                  <span>{value ? "正确" : "错误"}</span>
                </label>
              );
            })}
          </div>
        ) : null}

        {card.type === "cloze" ? (
          <input
            type="text"
            value={payload?.type === "cloze" ? (payload as { text: string }).text : ""}
            placeholder="填写空位内容"
            onChange={(event) => setPayload({ type: "cloze", text: event.target.value })}
          />
        ) : null}

        {card.type === "short_answer" ? (
          <textarea
            style={{ minHeight: 120 }}
            value={payload?.type === "short_answer" ? (payload as { text: string }).text : ""}
            placeholder="凭记忆作答，判定会逐条看你说到了哪些要点。"
            onChange={(event) => setPayload({ type: "short_answer", text: event.target.value })}
          />
        ) : null}
      </div>

      {error ? <div className="banner banner--err">{error}</div> : null}

      {result ? (
        <div className="card">
          <div className="row row--between">
            <strong>
              {result.mode === "judged" ? `本次 ${result.scorePercent} 分` : "已按自评记录"} ·
              评分「{RATING_LABEL[result.rating]}」
            </strong>
            <span className="pill pill--ok">下次复习：{result.intervalLabel}</span>
          </div>
          {result.needsReview ? (
            <div className="banner banner--warn" style={{ marginTop: 10, marginBottom: 0 }}>
              本次判定置信度不足，复习间隔暂不调整（待复核）。原因：
              {(result.reviewReasons ?? []).join("；") || "判定强度不足"}
            </div>
          ) : null}
          {result.points && result.points.length > 0 ? (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>得分点</th>
                  <th>命中概率</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {result.points.map((point) => (
                  <tr key={point.point_id}>
                    <td className="small">{point.statement}</td>
                    <td className="small">{point.probability.toFixed(2)}</td>
                    <td className="small">{point.awarded ? "命中" : "未命中"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn-primary" type="button" onClick={next}>
              下一张
            </button>
          </div>
        </div>
      ) : (
        <div className="card card--flat row row--between">
          <span className="small muted">答完提交即可，不需要自己判断对错。</span>
          <button className="btn-primary" type="button" disabled={pending} onClick={submit}>
            {pending ? "判定中…" : "提交判定"}
          </button>
        </div>
      )}
    </div>
  );
}
