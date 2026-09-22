import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, loginWithInvite, sessionCookieOptions } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
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
