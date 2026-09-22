import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { generateOutlineForMaterial } from "@/lib/services/generation";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUserFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as { topicCount?: number };
    const result = await generateOutlineForMaterial(user, id, { topicCount: body.topicCount });
    return NextResponse.json({
      blueprintId: result.blueprint.id,
      topics: result.topics,
      generatorModel: result.generatorModel,
      providerId: result.providerId,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
