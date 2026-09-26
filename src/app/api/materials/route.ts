import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { parseSourceMap } from "@/lib/ingest/schema";
import { createMaterialForUser, listMaterialsForUser } from "@/lib/services/materials";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const materials = await listMaterialsForUser(user);
    return NextResponse.json({
      materials: materials.map((material) => ({
        id: material.id,
        title: material.title,
        tokenCount: material.tokenCount,
        charCount: material.rawText.length,
        createdAt: material.createdAt,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const body = (await request.json()) as { title?: string; rawText?: string; sourceMap?: unknown };
    const material = await createMaterialForUser(user, {
      title: body.title ?? "",
      rawText: body.rawText ?? "",
      // 上传解析的页码映射由客户端回传，必须校验后再存
      sourceMap: parseSourceMap(body.sourceMap),
    });
    return NextResponse.json({ material: { id: material.id, title: material.title } }, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
