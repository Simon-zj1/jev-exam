import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { listMasteryForUser, listMistakeGroups } from "@/lib/services/mistakes";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const [groups, mastery] = await Promise.all([
      listMistakeGroups(user),
      listMasteryForUser(user),
    ]);
    return NextResponse.json({
      groups: groups.map((group) => ({
        materialId: group.materialId,
        materialTitle: group.materialTitle,
        count: group.items.length,
        items: group.items.map((item) => ({
          questionId: item.mistake.questionId,
          topicTitle: item.mistake.topicTitle,
          lastScorePercent: item.mistake.lastScorePercent,
          wrongCount: item.mistake.wrongCount,
          stem: item.studentView?.stem ?? null,
        })),
      })),
      mastery: mastery.map((record) => ({
        topicKey: record.topicKey,
        topicTitle: record.topicTitle,
        value: record.value,
        sampleCount: record.sampleCount,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
