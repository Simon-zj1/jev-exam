import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { askMaterialQuestion } from "@/lib/services/qa";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 就这份材料提问。返回的答案里每一句材料事实都带 [n] 引注，
 * citations 给出对应原文与页码；校验发现的问题放在 issues 里，由界面如实展示。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUserFromRequest(request);
    const { id } = await context.params;
    const body = (await request.json()) as { question?: unknown };
    if (typeof body.question !== "string") throw new ValidationError("请先输入问题");

    const answer = await askMaterialQuestion(user, id, body.question);
    return NextResponse.json({ answer });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
