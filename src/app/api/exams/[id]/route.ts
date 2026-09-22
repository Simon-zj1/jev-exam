import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { getStore } from "@/lib/db";
import { toErrorResponse } from "@/lib/errors";
import { getExamForUser } from "@/lib/services/generation";
import { toStudentQuestion } from "@/lib/services/questions";

/** 作答页数据：只返回题目本身，绝不返回答案与 rubric。 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUserFromRequest(request);
    const exam = await getExamForUser(user, id);
    const store = getStore();
    const questionIds = await store.listExamQuestionIds(exam.id);
    const questions = await store.getQuestions(questionIds);
    const attempt = await store.getOpenAttempt(exam.id, user.id);
    const answers = attempt ? await store.listAnswers(attempt.id) : [];

    return NextResponse.json({
      exam: {
        id: exam.id,
        title: exam.title,
        kind: exam.kind,
        questionCount: questionIds.length,
      },
      attemptId: attempt?.id ?? null,
      questions: questionIds
        .map((questionId) => questions.find((entry) => entry.id === questionId))
        .filter((question): question is NonNullable<typeof question> => Boolean(question))
        .map((question) => ({
          ...toStudentQuestion(question),
          draft: answers.find((answer) => answer.questionId === question.id)?.payload ?? null,
        })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
