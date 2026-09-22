import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import type { QuestionType } from "@/lib/config";
import { toErrorResponse } from "@/lib/errors";
import { createExamForMaterial } from "@/lib/services/generation";
import { listExamSummaries } from "@/lib/services/results";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const summaries = await listExamSummaries(user);
    return NextResponse.json({
      exams: summaries.map((summary) => ({
        id: summary.exam.id,
        title: summary.exam.title,
        kind: summary.exam.kind,
        materialId: summary.exam.materialId,
        materialTitle: summary.material?.title ?? null,
        questionCount: summary.exam.config.count,
        submittedAttempts: summary.submittedAttempts,
        latestScorePercent: summary.latestAttempt?.scorePercent ?? null,
        latestAttemptId: summary.latestAttempt?.id ?? null,
        createdAt: summary.exam.createdAt,
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
    const body = (await request.json()) as {
      materialId?: string;
      topicIds?: string[];
      mix?: Partial<Record<QuestionType, number>>;
      count?: number;
    };
    const result = await createExamForMaterial(user, {
      materialId: body.materialId ?? "",
      topicIds: body.topicIds ?? [],
      mix: body.mix,
      count: body.count,
    });
    return NextResponse.json(
      {
        examId: result.exam.id,
        questionCount: result.exam.config.count,
        providerId: result.providerId,
        generatorModel: result.generatorModel,
      },
      { status: 201 },
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
