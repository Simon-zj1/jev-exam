import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { RetryMistakesButton } from "@/components/retry-mistakes-button";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import {
  formatAnswer,
  formatCorrectAnswer,
  formatEngine,
  formatReviewReason,
  scoreTone,
} from "@/lib/format";
import { getAttemptResultForUser } from "@/lib/services/results";

export const dynamic = "force-dynamic";

export default async function AttemptResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let result;
  try {
    result = await getAttemptResultForUser(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { attempt, exam, totals, questions } = result;
  const tone = scoreTone(totals.scorePercent);
  const judgeEngine = questions.find((view) => view.judgment)?.judgment ?? null;

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <div className="row row--between">
          <div>
            <p className="small muted">
              <Link href={`/materials/${exam.materialId}`}>{exam.title}</Link> · 提交于{" "}
              {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString("zh-CN") : "—"}
            </p>
            <h1>判定报告</h1>
          </div>
          <div className="row no-print">
            <RetryMistakesButton examId={exam.id} />
            <PrintButton />
          </div>
        </div>

        <section className="card">
          <div className="grid grid--3">
            <div>
              <div className="small muted">总分</div>
              <div className="score">
                {totals.scorePercent}
                <span className="small muted"> / 100</span>
              </div>
              <div className="meter" style={{ marginTop: 10 }}>
                <div
                  className={`meter__fill meter__fill--${tone}`}
                  style={{ width: `${totals.scorePercent}%` }}
                />
              </div>
            </div>
            <div>
              <div className="small muted">待复核</div>
              <div className="score">{totals.needsReviewCount}</div>
              <div className="small muted">
                待复核题目不计入知识点掌握度，避免用不确定的分数误导复习方向。
              </div>
            </div>
            <div>
              <div className="small muted">客观题正确</div>
              <div className="score">
                {totals.objectiveCorrect}
                <span className="small muted"> / {totals.objectiveTotal}</span>
              </div>
              <div className="small muted">
                判定引擎：{judgeEngine ? judgeEngine.engineId : "未使用"} ·{" "}
                {judgeEngine ? judgeEngine.model : "—"}
              </div>
            </div>
          </div>
        </section>

        {questions.map((view) => {
          const judgment = view.judgment;
          const percent = judgment?.scorePercent ?? 0;
          return (
            <section className="question" key={view.question.id}>
              <div className="question__head">
                <span className="question__index">{view.position}</span>
                <span className="pill">{view.question.topicTitle}</span>
                {judgment?.needsReview ? (
                  <span className="pill pill--warn">待复核</span>
                ) : (
                  <span className={`pill ${percent >= 60 ? "pill--ok" : "pill--err"}`}>
                    {percent} 分
                  </span>
                )}
                {judgment ? <span className="small muted">{formatEngine(judgment)}</span> : null}
              </div>

              <p style={{ marginBottom: 10 }}>{view.question.stem}</p>

              <div className="grid grid--2">
                <div>
                  <div className="small muted">你的作答</div>
                  <div>{formatAnswer(view.question, view.payload)}</div>
                </div>
                <div>
                  <div className="small muted">参考答案</div>
                  <div>{formatCorrectAnswer(view.question)}</div>
                </div>
              </div>

              {judgment?.needsReview ? (
                <div className="banner banner--warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  本题标记为待复核
                  {judgment.scoreLow !== null && judgment.scoreHigh !== null
                    ? `，分数区间 ${Math.round(judgment.scoreLow * 100)}–${Math.round(
                        judgment.scoreHigh * 100,
                      )} 分`
                    : ""}
                  ：{judgment.reviewReasons.map(formatReviewReason).join("；")}
                </div>
              ) : null}

              {judgment && judgment.points.length > 0 ? (
                <div style={{ marginTop: 14 }}>
                  <div className="small muted">
                    逐点判定（这就是“为什么得这个分”的全部依据）
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>得分点</th>
                        <th>权重</th>
                        <th>命中概率</th>
                        <th>判定强度</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {judgment.points.map((point) => (
                        <tr key={point.point_id}>
                          <td className="small">{point.statement}</td>
                          <td className="small">{point.weight}</td>
                          <td className="small">{point.probability.toFixed(2)}</td>
                          <td className="small">{point.strength.toFixed(2)}</td>
                          <td className="small">{point.awarded ? "命中" : "未命中"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {judgment && judgment.penalties.length > 0 ? (
                <div className="banner banner--err" style={{ marginTop: 12, marginBottom: 0 }}>
                  代码侧扣分：
                  {judgment.penalties
                    .map(
                      (penalty) =>
                        `${penalty.label}（概率 ${penalty.probability.toFixed(2)}，扣分系数 ${penalty.weight}）`,
                    )
                    .join("；")}
                </div>
              ) : null}

              <details style={{ marginTop: 12 }}>
                <summary className="small muted">材料原文溯源</summary>
                <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                  {view.question.sourceAnchor}
                </p>
                {view.materialExcerpt && view.materialExcerpt !== view.question.sourceAnchor ? (
                  <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>
                    该知识点上下文：{view.materialExcerpt.slice(0, 400)}
                  </p>
                ) : null}
              </details>
            </section>
          );
        })}
      </main>
    </>
  );
}
