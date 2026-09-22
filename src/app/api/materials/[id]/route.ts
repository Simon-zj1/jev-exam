import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { getBlueprintForMaterial } from "@/lib/services/generation";
import { deleteMaterialForUser, getMaterialForUser } from "@/lib/services/materials";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUserFromRequest(request);
    const material = await getMaterialForUser(user, id);
    const blueprint = await getBlueprintForMaterial(material).catch(() => null);
    return NextResponse.json({
      material: {
        id: material.id,
        title: material.title,
        createdAt: material.createdAt,
        charCount: material.rawText.length,
      },
      topics: blueprint?.topics ?? [],
      generatorModel: blueprint?.generatorModel ?? null,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUserFromRequest(request);
    await deleteMaterialForUser(user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
