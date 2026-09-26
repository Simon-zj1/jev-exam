import {
  DEFAULT_QUESTION_COUNT,
  DEFAULT_QUESTION_MIX,
  MAX_QUESTION_COUNT,
  MIN_QUESTION_COUNT,
  type QuestionType,
} from "@/lib/config";
import { getStore } from "@/lib/db";
import type { BlueprintRecord, ExamRecord, MaterialRecord, UserRecord } from "@/lib/db/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { resolveGenerationProvider } from "@/lib/generator";
import { assertQuota, recordUsage } from "@/lib/quota";
import { usageCollector } from "@/lib/llm/usage";
import { readByok } from "@/lib/services/byok";
import { getMaterialForUser } from "@/lib/services/materials";
import { assertWithinSpendCap, recordChatUsage } from "@/lib/services/usage";
import { createId } from "@/lib/ids";
import type { AnswerKey, GeneratedQuestion, Outline, Topic } from "@/lib/types";

export type OutlineResult = {
  blueprint: BlueprintRecord;
  topics: Topic[];
  generatorModel: string;
  providerId: string;
};

export async function generateOutlineForMaterial(
  user: UserRecord,
  materialId: string,
  options: { topicCount?: number } = {},
): Promise<OutlineResult> {
  const material = await getMaterialForUser(user, materialId);
  const usage = usageCollector();
  const { provider, countsAgainstQuota } = resolveGenerationProvider({
    byok: readByok(user),
    onChatUsage: usage.onChatUsage,
  });
  if (countsAgainstQuota) await assertWithinSpendCap(user.id);

  const topicCount = clamp(options.topicCount ?? 6, 2, 12);
  let outline: Outline;
  try {
    outline = await provider.generateOutline({
      materialText: material.rawText,
      topicCount,
    });
  } finally {
    // 调用已经发生、成本已经产生，失败也要记账
    await recordChatUsage(user.id, usage.pending);
  }

  const blueprint = await getStore().saveBlueprint({
    materialId: material.id,
    topics: outline.topics,
    generatorModel: outline.generatorModel,
  });

  return {
    blueprint,
    topics: outline.topics,
    generatorModel: outline.generatorModel,
    providerId: provider.id,
  };
}

export type CreateExamInput = {
  materialId: string;
  topicIds: string[];
  mix?: Partial<Record<QuestionType, number>>;
  count?: number;
};

export type CreateExamResult = {
  exam: ExamRecord;
  questions: GeneratedQuestion[];
  providerId: string;
  generatorModel: string;
  dropped: unknown;
};

export async function createExamForMaterial(
  user: UserRecord,
  input: CreateExamInput,
): Promise<CreateExamResult> {
  const material = await getMaterialForUser(user, input.materialId);
  const blueprint = await getBlueprintForMaterial(material);

  const topicIds = input.topicIds.length > 0 ? input.topicIds : blueprint.topics.map((t) => t.id);
  const topics = blueprint.topics.filter((topic) => topicIds.includes(topic.id));
  if (topics.length === 0) throw new ValidationError("请至少选择一个知识点");

  const count = clamp(input.count ?? DEFAULT_QUESTION_COUNT, MIN_QUESTION_COUNT, MAX_QUESTION_COUNT);
  const mix = normalizeMix(input.mix);

  const usage = usageCollector();
  const { provider, countsAgainstQuota } = resolveGenerationProvider({
    byok: readByok(user),
    onChatUsage: usage.onChatUsage,
  });
  if (countsAgainstQuota) {
    await assertQuota(user.id, { question: count });
    await assertWithinSpendCap(user.id);
  }

  let generated;
  try {
    generated = await provider.generateQuestions({
      materialText: material.rawText,
      topics,
      mix,
      count,
    });
  } finally {
    await recordChatUsage(user.id, usage.pending);
  }

  const store = getStore();
  const blueprintId = blueprint.id;
  const records = generated.questions.map((question) => {
    const topic = topics.find((entry) => entry.id === question.topic_id) ?? topics[0];
    return {
      id: createId("q"),
      materialId: material.id,
      blueprintId,
      topicId: question.topic_id,
      topicTitle: topic?.title ?? "未分类",
      type: question.type,
      stem: question.type === "cloze" ? question.text_with_blank : question.stem,
      options: question.type === "mcq" ? question.options : null,
      answerKey: answerKeyOf(question),
      rubricPoints: question.type === "short_answer" ? question.rubric_points : null,
      sourceAnchor: question.source_anchor,
      difficulty: question.difficulty,
      explanation: question.explanation ?? null,
    };
  });

  await store.createQuestions(records);

  const exam = await store.createExam(
    {
      userId: user.id,
      materialId: material.id,
      blueprintId,
      title: `${material.title} · ${new Date().toLocaleDateString("zh-CN")}`,
      kind: "generated",
      config: { mix, count: records.length, topicIds: topics.map((topic) => topic.id) },
      generatorModel: generated.model,
    },
    records.map((record, index) => ({ questionId: record.id, position: index })),
  );

  if (countsAgainstQuota) await recordUsage(user.id, { question: records.length });

  return {
    exam,
    questions: generated.questions,
    providerId: provider.id,
    generatorModel: generated.model,
    dropped: generated.raw,
  };
}

/** 一键重考错题：复用原题目，不重新出题、不消耗出题额度。 */
export async function createMistakeRetryExam(
  user: UserRecord,
  materialId: string,
): Promise<{ exam: ExamRecord; questionIds: string[] }> {
  const material = await getMaterialForUser(user, materialId);
  const blueprint = await getBlueprintForMaterial(material);
  const store = getStore();
  const mistakes = (await store.listMistakes(user.id)).filter(
    (mistake) => mistake.materialId === materialId,
  );
  if (mistakes.length === 0) throw new ValidationError("该材料下没有错题");

  const questionIds: string[] = [];
  for (const mistake of mistakes) {
    const question = await store.getQuestion(mistake.questionId);
    if (question) questionIds.push(question.id);
  }
  if (questionIds.length === 0) throw new NotFoundError("错题对应的题目已被删除");

  const exam = await store.createExam(
    {
      userId: user.id,
      materialId: material.id,
      blueprintId: blueprint.id,
      title: `${material.title} · 错题重考`,
      kind: "mistake_retry",
      config: { mix: DEFAULT_QUESTION_MIX, count: questionIds.length, topicIds: [] },
      generatorModel: "reuse",
    },
    questionIds.map((questionId, index) => ({ questionId, position: index })),
  );

  return { exam, questionIds };
}

export async function getBlueprintForMaterial(material: MaterialRecord): Promise<BlueprintRecord> {
  const blueprint = await getStore().getBlueprintByMaterial(material.id);
  if (!blueprint) throw new NotFoundError("该材料还没有知识点大纲，请先生成大纲");
  return blueprint;
}

export async function getExamForUser(user: UserRecord, examId: string): Promise<ExamRecord> {
  const exam = await getStore().getExam(examId);
  if (!exam) throw new NotFoundError("试卷不存在");
  if (exam.userId !== user.id) throw new ForbiddenError();
  return exam;
}

export function normalizeMix(input?: Partial<Record<QuestionType, number>>): Record<QuestionType, number> {
  const mix: Record<QuestionType, number> = { ...DEFAULT_QUESTION_MIX };
  if (!input) return mix;
  let total = 0;
  for (const key of Object.keys(mix) as QuestionType[]) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      mix[key] = value;
    }
    total += mix[key];
  }
  if (total <= 0) return { ...DEFAULT_QUESTION_MIX };
  return mix;
}

function answerKeyOf(question: GeneratedQuestion): AnswerKey {
  switch (question.type) {
    case "mcq":
      return { mcq: { correct_index: question.correct_index } };
    case "true_false":
      return { true_false: { answer: question.answer } };
    case "cloze":
      return { cloze: { answer: question.answer, accepted: question.accepted } };
    case "short_answer":
      return {
        short_answer: {
          reference_answer: question.reference_answer,
          rubric_points: question.rubric_points,
        },
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
