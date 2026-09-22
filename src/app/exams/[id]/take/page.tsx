import { notFound, redirect } from "next/navigation";
import { ExamRunner, type RunnerQuestion } from "@/components/exam-runner";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { AnswerPayload } from "@/lib/grading";
import { getExamForUser } from "@/lib/services/generation";
import { engineStatus } from "@/lib/services/status";

export const dynamic = "force-dynamic";

export default async function TakeExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let exam;
  try {
    exam = await getExamForUser(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const store = getStore();
  const questionIds = await store.listExamQuestionIds(exam.id);
  const questions = await store.getQuestions(questionIds);
  const attempt = await store.getOpenAttempt(exam.id, user.id);
  const savedAnswers = attempt ? await store.listAnswers(attempt.id) : [];
  const status = engineStatus();

  const runnerQuestions: RunnerQuestion[] = questionIds
    .map((questionId) => questions.find((question) => question.id === questionId))
    .filter((question): question is NonNullable<typeof question> => Boolean(question))
    .map((question) => ({
      id: question.id,
      type: question.type as RunnerQuestion["type"],
      stem: question.stem,
      options: question.options,
      topicTitle: question.topicTitle,
      difficulty: question.difficulty,
      draft: (savedAnswers.find((answer) => answer.questionId === question.id)?.payload ??
        null) as AnswerPayload | null,
    }));

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>{exam.title}</h1>
        <p className="small muted">
          {runnerQuestions.length} 题 · 交卷后判定引擎为 {status.judgeLabel}
          {status.judgeMode === "offline" ? "（离线演示，质量不代表真实 Jev）" : ""}
        </p>

        {runnerQuestions.length === 0 ? (
          <div className="empty">这份试卷没有题目。</div>
        ) : (
          <ExamRunner examId={exam.id} questions={runnerQuestions} />
        )}
      </main>
    </>
  );
}
