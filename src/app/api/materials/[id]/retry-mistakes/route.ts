import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { createMistakeRetryExam } from "@/lib/services/generation";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUserFromRequest(request);
    const result = await createMistakeRetryExam(user, id);
    return NextResponse.json(
      { examId: result.exam.id, questionCount: result.questionIds.length },
      { status: 201 },
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
