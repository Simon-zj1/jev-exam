import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { byokSchema } from "@/lib/byok";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { clearByok, readByok, summarizeByok, writeByok } from "@/lib/services/byok";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    return NextResponse.json({ byok: summarizeByok(readByok(user)) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const body = (await request.json()) as unknown;
    const parsed = byokSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(`密钥配置不合法：${parsed.error.message}`);
    const next = await writeByok(user.id, parsed.data);
    return NextResponse.json({ byok: summarizeByok(next) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await clearByok(user.id);
    return NextResponse.json({ byok: summarizeByok(null) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
