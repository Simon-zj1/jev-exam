import { getStore } from "@/lib/db";
import type { MasteryRecord, MistakeRecord, QuestionRecord, UserRecord } from "@/lib/db/types";
import { toStudentQuestion } from "@/lib/services/questions";

export type MistakeItemView = {
  mistake: MistakeRecord;
  question: QuestionRecord | null;
  studentView: ReturnType<typeof toStudentQuestion> | null;
};

export type MistakeGroup = {
  materialId: string;
  materialTitle: string;
  items: MistakeItemView[];
};

export async function listMistakesForUser(user: UserRecord): Promise<MistakeItemView[]> {
  const store = getStore();
  const mistakes = await store.listMistakes(user.id);
  const views: MistakeItemView[] = [];
  for (const mistake of mistakes) {
    const question = await store.getQuestion(mistake.questionId);
    views.push({
      mistake,
      question,
      studentView: question ? toStudentQuestion(question) : null,
    });
  }
  return views;
}

export async function listMistakeGroups(user: UserRecord): Promise<MistakeGroup[]> {
  const store = getStore();
  const items = await listMistakesForUser(user);
  const materials = await store.listMaterials(user.id);
  const titleById = new Map(materials.map((material) => [material.id, material.title]));

  const groups = new Map<string, MistakeGroup>();
  for (const item of items) {
    const materialId = item.mistake.materialId;
    const group =
      groups.get(materialId) ??
      {
        materialId,
        materialTitle: titleById.get(materialId) ?? "（材料已删除）",
        items: [],
      };
    group.items.push(item);
    groups.set(materialId, group);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

export async function listMasteryForUser(user: UserRecord): Promise<MasteryRecord[]> {
  return getStore().listMastery(user.id);
}

/** 薄弱点：掌握度最低的若干知识点。 */
export async function listWeakTopics(user: UserRecord, limit = 5): Promise<MasteryRecord[]> {
  const mastery = await listMasteryForUser(user);
  return mastery.slice(0, limit);
}
