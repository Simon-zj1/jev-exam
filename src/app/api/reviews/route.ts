import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { listDueReviewCards, reviewStats } from "@/lib/services/reviews";

/** 今日复习队列：到期（含逾期）的卡片，按到期时间排序 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
    const [stats, cards] = await Promise.all([
      reviewStats(user),
      listDueReviewCards(user, limit),
    ]);

    return NextResponse.json({
      stats: {
        due: stats.due,
        total: stats.total,
        learning: stats.learning,
        nextDueAt: stats.nextDueAt,
      },
      cards: cards.map((card) => ({
        questionId: card.question.id,
        type: card.question.type,
        stem: card.question.stem,
        options: card.question.options,
        topicTitle: card.question.topicTitle,
        state: card.item.state,
        reps: card.item.reps,
        lapses: card.item.lapses,
        dueAt: card.item.dueAt,
        overdueDays: card.overdueDays,
        lastScorePercent: card.item.lastScorePercent,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
