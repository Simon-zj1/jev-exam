import { getStore } from "@/lib/db";
import {
  FEEDBACK_KIND_LABEL,
  type FeedbackKind,
  type UserRecord,
} from "@/lib/db/types";
import { toStudentQuestion } from "@/lib/services/questions";
import { todayLlmUsage } from "@/lib/services/usage";

/**
 * 数据导出。
 *
 * 用户真正的资产是「材料 + 错题 + 掌握度」，不是这个网站本身。
 * 所以导出必须做成完整、可迁移、不锁格式的：JSON 用于备份与迁移，
 * Markdown 用于阅读，Anki CSV 用于把复习卡片搬进用户已有的工具。
 */

export type BackupBundle = {
  format: "jev-exam-backup";
  version: 1;
  exportedAt: string;
  user: { email: string; createdAt: string };
  materials: unknown[];
  blueprints: unknown[];
  questions: unknown[];
  exams: unknown[];
  attempts: unknown[];
  answers: unknown[];
  judgments: unknown[];
  mastery: unknown[];
  mistakes: unknown[];
  reviews: unknown[];
  feedback: unknown[];
  usage: unknown;
};

export async function buildBackup(user: UserRecord): Promise<BackupBundle> {
  const store = getStore();
  const [materials, exams, attempts, mastery, mistakes, reviews, feedback, usage] =
    await Promise.all([
      store.listMaterials(user.id),
      store.listExams(user.id),
      store.listAttemptsByUser(user.id),
      store.listMastery(user.id),
      store.listMistakes(user.id),
      store.listReviewItems(user.id),
      store.listFeedback(user.id),
      todayLlmUsage(user.id),
    ]);

  const questions = await Promise.all(
    materials.map((material) => store.listQuestionsByMaterial(material.id)),
  );
  const blueprints = await Promise.all(
    materials.map((material) => store.getBlueprintByMaterial(material.id)),
  );
  const examQuestionIds = new Map<string, string[]>();
  for (const exam of exams) {
    examQuestionIds.set(exam.id, await store.listExamQuestionIds(exam.id));
  }
  const answers = await Promise.all(attempts.map((attempt) => store.listAnswers(attempt.id)));
  const judgments = await Promise.all(
    attempts.map((attempt) => store.listJudgmentsByAttempt(attempt.id)),
  );

  return {
    format: "jev-exam-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { email: user.email, createdAt: user.createdAt.toISOString() },
    materials: materials.map((material) => ({
      id: material.id,
      title: material.title,
      rawText: material.rawText,
      tokenCount: material.tokenCount,
      sourceMap: material.sourceMap,
      createdAt: material.createdAt,
    })),
    blueprints: blueprints.filter(Boolean),
    questions: questions.flat(),
    exams: exams.map((exam) => ({
      ...exam,
      questionIds: examQuestionIds.get(exam.id) ?? [],
    })),
    attempts,
    answers: answers.flat(),
    judgments: judgments.flat(),
    mastery,
    mistakes,
    reviews,
    feedback,
    usage,
  };
}

/** CSV 转义：字段里出现引号、逗号、换行都要按 RFC 4180 处理。 */
function csvField(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return `"${normalized.replace(/"/g, '""')}"`;
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}

/**
 * Anki 可导入的 CSV（正好对应 Anki 的「基础」卡片：正面 / 反面 / 标签）。
 * 只导出有题目的内容；答案出自题目自身，不依赖这个网站继续存在。
 */
export async function buildAnkiCsv(user: UserRecord): Promise<string> {
  const store = getStore();
  const materials = await store.listMaterials(user.id);
  const reviews = await store.listReviewItems(user.id);
  const mistakes = await store.listMistakes(user.id);

  const rows: string[] = [
    ["正面", "反面", "标签"].map(csvField).join(","),
  ];
  const seen = new Set<string>();

  for (const material of materials) {
    const questions = await store.listQuestionsByMaterial(material.id);
    const questionById = new Map(questions.map((question) => [question.id, question]));

    // 错题与复习卡优先：它们才是「需要反复看」的部分
    const tracked = [
      ...reviews.filter((item) => item.materialId === material.id).map((item) => item.questionId),
      ...mistakes.filter((item) => item.materialId === material.id).map((item) => item.questionId),
      ...questions.map((question) => question.id),
    ];

    for (const questionId of tracked) {
      if (seen.has(questionId)) continue;
      const question = questionById.get(questionId);
      if (!question) continue;
      seen.add(questionId);

      const view = toStudentQuestion(question);
      const front =
        question.type === "mcq" && question.options
          ? `${view.stem}\n${question.options
              .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
              .join("\n")}`
          : view.stem;

      const back =
        question.type === "short_answer"
          ? [
              question.answerKey.short_answer?.reference_answer ?? "",
              "得分点：",
              ...(question.rubricPoints ?? []).map(
                (point) => `- ${point.statement}（依据：${point.evidence_span}）`,
              ),
            ]
              .filter(Boolean)
              .join("\n")
          : (question.answerKey.mcq
              ? `答案：${String.fromCharCode(65 + question.answerKey.mcq.correct_index)}`
              : question.answerKey.true_false
                ? `答案：${question.answerKey.true_false.answer ? "正确" : "错误"}`
                : `答案：${question.answerKey.cloze?.answer ?? ""}`);

      const tags = [
        "jev-exam",
        material.title.replace(/[\s,]/g, "_"),
        question.topicTitle.replace(/[\s,]/g, "_"),
      ];
      rows.push(csvRow([front, `${back}\n\n出处：${question.sourceAnchor}`, tags.join(" ")]));
    }
  }

  return rows.join("\n");
}

/** Markdown 导出：材料正文 + 题目与评分点 + 错题与掌握度，用于阅读与迁移。 */
export async function buildMarkdownExport(user: UserRecord): Promise<string> {
  const store = getStore();
  const materials = await store.listMaterials(user.id);
  const mastery = await store.listMastery(user.id);
  const mistakes = await store.listMistakes(user.id);
  const reviews = await store.listReviewItems(user.id);

  const lines: string[] = [
    `# Jev 备考 · 数据导出`,
    "",
    `- 账号：${user.email}`,
    `- 导出时间：${new Date().toLocaleString("zh-CN")}`,
    `- 材料 ${materials.length} 份 · 错题 ${mistakes.length} 道 · 复习卡 ${reviews.length} 张`,
    "",
    "> 这份文件由你自己导出，与网站无关也可以独立阅读。",
    "",
  ];

  for (const material of materials) {
    const questions = await store.listQuestionsByMaterial(material.id);
    lines.push(`---`, "", `## ${material.title}`, "");
    if (material.sourceMap?.fileName) {
      lines.push(
        `> 来源：${material.sourceMap.fileName}${
          material.sourceMap.pageCount ? ` · ${material.sourceMap.pageCount} 页` : ""
        }`,
        "",
      );
    }
    lines.push("### 材料原文", "", material.rawText, "");
    if (questions.length > 0) {
      lines.push("### 题目与评分点", "");
      questions.forEach((question, index) => {
        const view = toStudentQuestion(question);
        lines.push(`**${index + 1}. ${view.stem}**`, "");
        if (question.type === "mcq" && question.options) {
          question.options.forEach((option, optionIndex) => {
            lines.push(`- ${String.fromCharCode(65 + optionIndex)}. ${option}`);
          });
          lines.push("", `> 答案：${String.fromCharCode(65 + (question.answerKey.mcq?.correct_index ?? 0))}`);
        } else if (question.type === "true_false") {
          lines.push(`> 答案：${question.answerKey.true_false?.answer ? "正确" : "错误"}`);
        } else if (question.type === "cloze") {
          lines.push(`> 答案：${question.answerKey.cloze?.answer ?? ""}`);
        } else {
          lines.push(`> 参考答案：${question.answerKey.short_answer?.reference_answer ?? ""}`, "");
          for (const point of question.rubricPoints ?? []) {
            lines.push(`- 得分点：${point.statement}（依据：${point.evidence_span}）`);
          }
        }
        lines.push("", `> 出处：${question.sourceAnchor}`, "");
      });
    }
  }

  if (mistakes.length > 0 || mastery.length > 0) {
    lines.push("---", "", "## 学习状态", "");
    if (mistakes.length > 0) {
      lines.push("### 错题", "", "| 知识点 | 最近得分 | 累计错次 |", "| --- | --- | --- |");
      for (const mistake of mistakes) {
        lines.push(
          `| ${mistake.topicTitle} | ${mistake.lastScorePercent} | ${mistake.wrongCount} |`,
        );
      }
      lines.push("");
    }
    if (mastery.length > 0) {
      lines.push("### 知识点掌握度", "", "| 知识点 | 掌握度 | 样本数 |", "| --- | --- | --- |");
      for (const record of mastery) {
        lines.push(
          `| ${record.topicTitle} | ${Math.round(record.value * 100)}% | ${record.sampleCount} |`,
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** 纠错上报导出成金标准候选：人工确认后即可并入 eval/golden。 */
export async function buildFeedbackCandidates(): Promise<string> {
  const reports = await getStore().listFeedback(null);
  return reports
    .map((report) =>
      JSON.stringify({
        id: report.id,
        kind: report.kind,
        kindLabel: FEEDBACK_KIND_LABEL[report.kind as FeedbackKind] ?? report.kind,
        note: report.note,
        materialTitle: report.snapshot.materialTitle,
        question: report.snapshot.stem,
        answer: report.snapshot.payload,
        judgedScorePercent: report.snapshot.scorePercent,
        needsReview: report.snapshot.needsReview,
        engine: report.snapshot.engineId,
        model: report.snapshot.engineModel,
        points: report.snapshot.points,
        createdAt: report.createdAt.toISOString(),
      }),
    )
    .join("\n");
}
