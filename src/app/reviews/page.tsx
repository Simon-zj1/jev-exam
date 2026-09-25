import Link from "next/link";
import { redirect } from "next/navigation";
import { ReviewRunner, type ReviewCardView } from "@/components/review-runner";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { listDueReviewCards, reviewStats } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [cards, stats] = await Promise.all([listDueReviewCards(user, 20), reviewStats(user)]);

  const views: ReviewCardView[] = cards.map((card) => ({
    questionId: card.question.id,
    type: card.question.type as ReviewCardView["type"],
    stem: card.question.stem,
    options: card.question.options,
    topicTitle: card.question.topicTitle,
    state: card.item.state,
    reps: card.item.reps,
    lapses: card.item.lapses,
    overdueDays: card.overdueDays,
    lastScorePercent: card.item.lastScorePercent,
  }));

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>今日复习</h1>
        <p className="muted small">
          按 FSRS 间隔重复排期：答错的题目先进入队列，之后每复习一次就按你的表现重新安排下次时间，
          答得稳的间隔会越来越长。待复核的判定不会影响排期。
        </p>

        <section className="card">
          <div className="grid grid--3">
            <div>
              <div className="small muted">今天待复习</div>
              <div className="score">{stats.due}</div>
            </div>
            <div>
              <div className="small muted">复习队列总卡片</div>
              <div className="score">{stats.total}</div>
            </div>
            <div>
              <div className="small muted">下次到期</div>
              <div className="small">
                {stats.nextDueAt ? stats.nextDueAt.toLocaleString("zh-CN") : "暂无排期"}
              </div>
            </div>
          </div>
          {stats.total === 0 ? (
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
              还没有复习卡片。去做一套题，答错的题会自动进入复习队列：
              <Link href="/materials"> 上传材料 →</Link>
            </p>
          ) : null}
        </section>

        {views.length > 0 ? <ReviewRunner cards={views} /> : null}
      </main>
    </>
  );
}
