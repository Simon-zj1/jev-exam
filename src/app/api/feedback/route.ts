import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { listFeedbackForUser, submitFeedbackForUser } from "@/lib/services/feedback";

export const runtime = "nodejs";

/** 我提交过的纠错。 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const reports = await listFeedbackForUser(user);
    return NextResponse.json({
      reports: reports.map((report) => ({
        id: report.id,
        kind: report.kind,
        note: report.note,
        questionId: report.questionId,
        createdAt: report.createdAt,
        status: report.status,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** 提交一条纠错：判定分数不对 / 参考答案不对 / 题目本身有问题。 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const body = (await request.json()) as {
      questionId?: unknown;
      attemptId?: unknown;
      kind?: unknown;
      note?: unknown;
    };
    if (typeof body.questionId !== "string") throw new ValidationError("缺少 questionId");
    if (typeof body.kind !== "string") throw new ValidationError("请选择问题类型");

    const report = await submitFeedbackForUser(user, {
      questionId: body.questionId,
      attemptId: typeof body.attemptId === "string" ? body.attemptId : null,
      kind: body.kind,
      note: typeof body.note === "string" ? body.note : null,
    });

    return NextResponse.json(
      { report: { id: report.id, kind: report.kind, createdAt: report.createdAt } },
      { status: 201 },
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
