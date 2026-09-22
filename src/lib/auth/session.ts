import { cookies } from "next/headers";
import { normalizeEmail, isValidEmail } from "@/lib/auth/email";
import { signSessionToken, verifySessionToken } from "@/lib/crypto";
import { bootstrapStore, getStore } from "@/lib/db";
import type { UserRecord } from "@/lib/db/types";
import { AppError, UnauthorizedError, ValidationError } from "@/lib/errors";

export const SESSION_COOKIE = "jev_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type Session = {
  userId: string;
  email: string;
};

/**
 * 认证提供方抽象。
 *
 * MVP 默认实现是「邀请码 + 邮箱」的签名 Cookie 会话（无需外部服务即可运行）。
 * 要换成 Supabase Auth（邮箱 OTP + RLS），只需实现同一个接口并在 resolveAuthProvider 里替换，
 * 业务代码与路由都不需要改动。
 */
export interface AuthProvider {
  readonly id: string;
  getSession(cookieValue: string | undefined): Session | null;
  createSessionCookieValue(session: Session): string;
}

export class SignedCookieAuthProvider implements AuthProvider {
  readonly id = "signed-cookie";

  getSession(cookieValue: string | undefined): Session | null {
    if (!cookieValue) return null;
    const payload = verifySessionToken<Session & { exp?: number }>(cookieValue);
    if (!payload?.userId) return null;
    return { userId: payload.userId, email: payload.email };
  }

  createSessionCookieValue(session: Session): string {
    return signSessionToken({ userId: session.userId, email: session.email }, SESSION_TTL_SECONDS);
  }
}

export function resolveAuthProvider(): AuthProvider {
  return new SignedCookieAuthProvider();
}

export type LoginResult = { user: UserRecord; created: boolean; cookieValue: string };

/**
 * 邀请制登录：已有用户直接登录；新用户必须提供有效邀请码。
 */
export async function loginWithInvite(email: string, inviteCode?: string): Promise<LoginResult> {
  if (!isValidEmail(email)) throw new ValidationError("邮箱格式不正确");
  const store = getStore();
  await bootstrapStore(store);
  const normalized = normalizeEmail(email);

  const existing = await store.getUserByEmail(normalized);
  if (existing) {
    const provider = resolveAuthProvider();
    return {
      user: existing,
      created: false,
      cookieValue: provider.createSessionCookieValue({ userId: existing.id, email: existing.email }),
    };
  }

  if (!inviteCode || inviteCode.trim().length === 0) {
    throw new ValidationError("首次使用需要邀请码");
  }

  const consumed = await store.consumeInviteCode(inviteCode);
  if (!consumed) throw new AppError("邀请码无效、已过期或已用完", 403, "invite_invalid");

  const user = await store.createUser(normalized);
  const provider = resolveAuthProvider();
  return {
    user,
    created: true,
    cookieValue: provider.createSessionCookieValue({ userId: user.id, email: user.email }),
  };
}

export function sessionFromCookieValue(cookieValue: string | undefined): Session | null {
  return resolveAuthProvider().getSession(cookieValue);
}

export async function getCurrentUser(): Promise<UserRecord | null> {
  const cookieStore = await cookies();
  const session = sessionFromCookieValue(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return getStore().getUser(session.userId);
}

export async function requireCurrentUser(): Promise<UserRecord> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  };
}
