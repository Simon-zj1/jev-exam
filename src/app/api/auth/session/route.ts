import { NextResponse, type NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth/request";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({ user: { id: user.id, email: user.email } });
}
