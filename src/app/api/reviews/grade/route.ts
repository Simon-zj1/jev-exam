import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import type { ReviewRating } from "@/lib/fsrs";
import { assertAnswerShape } from "@/lib/services/attempts";
import { gradeReviewAnswer, selfReportReview } from "@/lib/services/reviews";

/**
 * 复习一张卡片。两种用法：
 * - 默认：先判定再按分数推进排期（客观题即时，主观题走引擎）；
 * - rating=1..4：学习者自评（例如手写作答无法自动判定时）。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const body = (await request.json()) as {
      questionId?: unknown;
      payload?: unknown;
      rating?: unknown;
    };
    if (typeof body.questionId !== "string") throw new ValidationError("缺少 questionId");

    if (typeof body.rating === "number") {
      const result = await selfReportReview(user, body.questionId, body.rating as ReviewRating);
      return NextResponse.json({ mode: "self-report", ...result });
    }

    const result = await gradeReviewAnswer(user, body.questionId, assertAnswerShape(body.payload));
    return NextResponse.json({ mode: "judged", ...result });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
