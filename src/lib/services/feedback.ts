import { getStore } from "@/lib/db";
import {
  FEEDBACK_KIND_LABEL,
  type FeedbackKind,
  type FeedbackRecord,
  type FeedbackSnapshot,
  type UserRecord,
} from "@/lib/db/types";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type SubmitFeedbackInput = {
  questionId: string;
  attemptId?: string | null;
  kind: string;
  note?: string | null;
};

const KINDS = Object.keys(FEEDBACK_KIND_LABEL) as FeedbackKind[];

/**
 * 用户说「这题判错了」。
 *
 * 教育产品里判错一次就会失信，所以必须有一条明确的出口：既让用户看到我们在收集，
 * 也把当时的现场冻结下来——之后人工确认就能变成金标准集里的一条标注，
 * 这是把评测集做大的天然来源，而不是靠我们自己编题。
 */
export async function submitFeedbackForUser(
  user: UserRecord,
  input: SubmitFeedbackInput,
): Promise<FeedbackRecord> {
  const kind = input.kind as FeedbackKind;
  if (!KINDS.includes(kind)) throw new ValidationError("请选择问题类型");

  const note = (input.note ?? "").trim().slice(0, 1000);
  const store = getStore();
  const question = await store.getQuestion(input.questionId);
  if (!question) throw new NotFoundError("题目不存在");

  const material = await store.getMaterial(question.materialId);
  if (!material || material.userId !== user.id) throw new NotFoundError("题目不存在");

  // 定位到具体的判定；没给 attemptId 就找这个用户最近一次判过这道题的记录
  const attempts = input.attemptId
    ? [await store.getAttempt(input.attemptId)]
    : await store.listAttemptsByUser(user.id);
  let judgment = null as Awaited<ReturnType<typeof store.getJudgmentByAnswer>> | null;
  for (const attempt of attempts) {
    if (!attempt || attempt.userId !== user.id) continue;
    const judgments = await store.listJudgmentsByAttempt(attempt.id);
    const hit = judgments.find((entry) => entry.questionId === question.id);
    if (hit) {
      judgment = hit;
      break;
    }
  }

  const snapshot: FeedbackSnapshot = {
    materialTitle: material.title,
    questionType: question.type,
    stem: question.stem,
    payload: null,
    scorePercent: judgment?.scorePercent ?? null,
    needsReview: judgment?.needsReview ?? false,
    engineId: judgment?.engineId ?? null,
    engineModel: judgment?.model ?? null,
    referenceAnswer: question.answerKey.short_answer?.reference_answer ?? null,
    points: (judgment?.points ?? []).map((point) => ({
      point_id: point.point_id,
      statement: point.statement,
      probability: point.probability,
      awarded: point.awarded,
    })),
  };

  // 作答原文也一并冻结：只看判定结果无法复核「模型是不是没读懂」
  if (judgment) {
    const answers = await store.listAnswers(judgment.attemptId);
    snapshot.payload = answers.find((answer) => answer.questionId === question.id)?.payload ?? null;
  }

  return store.createFeedback({
    userId: user.id,
    questionId: question.id,
    attemptId: judgment?.attemptId ?? input.attemptId ?? null,
    kind,
    note: note || null,
    snapshot,
  });
}

export async function listFeedbackForUser(user: UserRecord): Promise<FeedbackRecord[]> {
  return getStore().listFeedback(user.id);
}

export const FEEDBACK_KIND_OPTIONS = KINDS.map((kind) => ({
  value: kind,
  label: FEEDBACK_KIND_LABEL[kind],
}));
