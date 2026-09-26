import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { assertAnswerShape, submitAttemptForUser } from "@/lib/services/attempts";
import { rateLimitResponse } from "@/lib/http/rate-guard";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimitResponse(request, "judge");
    if (limited) return limited;

    const { id } = await context.params;
    const user = await requireUserFromRequest(request);
    const body = (await request.json()) as {
      answers?: { questionId?: string; payload?: unknown }[];
    };

    const answers = (body.answers ?? [])
      .filter((answer): answer is { questionId: string; payload?: unknown } =>
        typeof answer.questionId === "string",
      )
      .map((answer) => ({
        questionId: answer.questionId,
        payload: assertAnswerShape(answer.payload),
      }));

    const result = await submitAttemptForUser(user, id, answers);
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
