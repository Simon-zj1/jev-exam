import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, loginWithInvite, sessionCookieOptions } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors";
import { rateLimitResponse } from "@/lib/http/rate-guard";

export async function POST(request: NextRequest) {
  try {
    // 登录是唯一不需要会话的写接口，必须限流，否则邀请码可以被无限次试
    const limited = rateLimitResponse(request, "login");
    if (limited) return limited;

    const body = (await request.json()) as { email?: string; inviteCode?: string };
    const result = await loginWithInvite(body.email ?? "", body.inviteCode);

    const response = NextResponse.json({
      user: { id: result.user.id, email: result.user.email },
      created: result.created,
    });
    response.cookies.set(SESSION_COOKIE, result.cookieValue, sessionCookieOptions());
    return response;
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
