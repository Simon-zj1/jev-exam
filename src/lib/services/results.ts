import { getStore } from "@/lib/db";
import type {
  AttemptRecord,
  ExamRecord,
  JudgmentRecord,
  MaterialRecord,
  QuestionRecord,
  UserRecord,
} from "@/lib/db/types";
import type { AnswerPayload } from "@/lib/grading";
import { getExamForUser } from "@/lib/services/generation";
import { getAttemptForUser } from "@/lib/services/attempts";
import { toStudentQuestion } from "@/lib/services/questions";

export type ResultQuestionView = {
  position: number;
  question: QuestionRecord;
  studentView: ReturnType<typeof toStudentQuestion>;
  payload: AnswerPayload | null;
  judgment: JudgmentRecord | null;
  materialExcerpt: string;
};

export type AttemptResultView = {
  attempt: AttemptRecord;
  exam: ExamRecord;
  material: MaterialRecord | null;
  questions: ResultQuestionView[];
  totals: {
    scorePercent: number;
    needsReviewCount: number;
    objectiveCorrect: number;
    objectiveTotal: number;
  };
};

export async function getAttemptResultForUser(
  user: UserRecord,
  attemptId: string,
): Promise<AttemptResultView> {
  const attempt = await getAttemptForUser(user, attemptId);
  const exam = await getExamForUser(user, attempt.examId);
  const store = getStore();

  const questionIds = await store.listExamQuestionIds(exam.id);
  const questions = await store.getQuestions(questionIds);
  const answers = await store.listAnswers(attempt.id);
  const judgments = await store.listJudgmentsByAttempt(attempt.id);
  const material = await store.getMaterial(exam.materialId);
  const blueprint = await store.getBlueprintById(exam.blueprintId);

  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const judgmentByQuestion = new Map(judgments.map((judgment) => [judgment.questionId, judgment]));
  const spansByTopic = new Map(
    (blueprint?.topics ?? []).map((topic) => [topic.id, topic.source_spans.join("\n")]),
  );

  const views: ResultQuestionView[] = questionIds
    .map((questionId, index) => {
      const question = questions.find((entry) => entry.id === questionId);
      if (!question) return null;
      const answer = answerByQuestion.get(questionId);
      return {
        position: index + 1,
        question,
        studentView: toStudentQuestion(question),
        payload: answer?.payload ?? null,
        judgment: judgmentByQuestion.get(questionId) ?? null,
        materialExcerpt: spansByTopic.get(question.topicId) ?? "",
      } satisfies ResultQuestionView;
    })
    .filter((view): view is ResultQuestionView => Boolean(view));

  const objective = views.filter((view) => view.question.type !== "short_answer");
  return {
    attempt,
    exam,
    material,
    questions: views,
    totals: {
      scorePercent: attempt.scorePercent ?? 0,
      needsReviewCount: attempt.needsReviewCount ?? 0,
      objectiveCorrect: objective.filter((view) => (view.judgment?.scorePercent ?? 0) >= 60).length,
      objectiveTotal: objective.length,
    },
  };
}

export type ExamSummary = {
  exam: ExamRecord;
  material: MaterialRecord | null;
  submittedAttempts: number;
  latestAttempt: AttemptRecord | null;
};

/** 试卷列表 + 最近一次提交结果，供材料/首页展示。 */
export async function listExamSummaries(user: UserRecord): Promise<ExamSummary[]> {
  const store = getStore();
  const [exams, attempts] = await Promise.all([
    store.listExams(user.id),
    store.listAttemptsByUser(user.id),
  ]);
  const materials = await Promise.all(exams.map((exam) => store.getMaterial(exam.materialId)));

  return exams.map((exam, index) => {
    const examAttempts = attempts
      .filter((attempt) => attempt.examId === exam.id && attempt.status === "submitted")
      .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));
    return {
      exam,
      material: materials[index] ?? null,
      submittedAttempts: examAttempts.length,
      latestAttempt: examAttempts[0] ?? null,
    };
  });
}
