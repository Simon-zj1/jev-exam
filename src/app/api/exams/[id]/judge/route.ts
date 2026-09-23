import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { assertAnswerShape, judgeOneAnswerForUser } from "@/lib/services/attempts";

/**
 * 判定单题：让界面可以逐题显示结果，而不是等全部判完。
 * 客观题不需要引擎（确定性判分），主观题每个得分点并行判定。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUserFromRequest(request);
    const body = (await request.json()) as { questionId?: unknown; payload?: unknown };
    if (typeof body.questionId !== "string") throw new ValidationError("缺少 questionId");

    const result = await judgeOneAnswerForUser(
      user,
      id,
      body.questionId,
      assertAnswerShape(body.payload),
    );
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
