import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { deleteAccountForUser } from "@/lib/services/account";

export const runtime = "nodejs";

/** 删除账号：需要输入自己的邮箱二次确认，删除后会话立即失效。 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as { confirmEmail?: unknown };
    if (typeof body.confirmEmail !== "string") throw new ValidationError("请输入当前账号的邮箱以确认");

    await deleteAccountForUser(user, body.confirmEmail);

    const response = NextResponse.json({ deleted: true });
    // 删号后把会话 Cookie 一起清掉，否则浏览器还留着一个指向不存在用户的会话
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
