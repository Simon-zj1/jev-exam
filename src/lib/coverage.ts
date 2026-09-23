import { locateAnchor } from "@/lib/generator/validate";
import { similarity } from "@/lib/text";
import type { GeneratedQuestion, Topic } from "@/lib/types";
import { splitSentences } from "@/lib/text";

/**
 * 覆盖率校验：材料里的要点，有多少真的被出了题。
 *
 * 出题模型只保证「每道题都能溯源」，不保证「材料被覆盖完整」。
 * 于是会出现一份看起来很漂亮、却漏掉半章内容的试卷。
 * 这里把没被任何题目锚点覆盖到的句子如实列出来，标成未覆盖，
 * 而不是假装完整——这与 learn-from-materials 的 coverage 校验是同一个思路。
 */

export const COVERAGE_SIMILARITY_THRESHOLD = 0.6;

export type CoverageUnit = {
  index: number;
  text: string;
  coveredBy: string[];
};

export type CoverageReport = {
  unitCount: number;
  coveredCount: number;
  coverageRatio: number;
  units: CoverageUnit[];
  uncovered: { index: number; text: string }[];
  anchorFailures: { questionId: string; field: string; value: string }[];
  topicCoverage: {
    topicId: string;
    title: string;
    questionCount: number;
    covered: boolean;
  }[];
};

export function verifyCoverage(
  material: string,
  topics: Topic[],
  questions: GeneratedQuestion[],
): CoverageReport {
  const sentences = splitSentences(material).map((text, index) => ({ index, text }));
  const units: CoverageUnit[] = sentences.map((unit) => ({ ...unit, coveredBy: [] }));
  const anchorFailures: CoverageReport["anchorFailures"] = [];

  for (const question of questions) {
    const claims: { field: string; value: string }[] = [
      { field: "source_anchor", value: question.source_anchor },
      ...(question.type === "short_answer"
        ? question.rubric_points.map((point) => ({
            field: `rubric_point.${point.point_id}.evidence_span`,
            value: point.evidence_span,
          }))
        : []),
    ];

    for (const claim of claims) {
      if (!claim.value.trim()) continue;
      if (!locateAnchor(material, claim.value).found) {
        anchorFailures.push({ questionId: question.id, field: claim.field, value: claim.value });
        continue;
      }
      for (const unit of units) {
        if (covers(claim.value, unit.text)) unit.coveredBy.push(question.id);
      }
    }
  }

  const uncovered = units
    .filter((unit) => unit.coveredBy.length === 0)
    .map((unit) => ({ index: unit.index, text: unit.text }));

  const topicCoverage = topics.map((topic) => {
    const topicQuestions = questions.filter((question) => question.topic_id === topic.id);
    return {
      topicId: topic.id,
      title: topic.title,
      questionCount: topicQuestions.length,
      covered: topicQuestions.length > 0,
    };
  });

  const coveredCount = units.length - uncovered.length;
  return {
    unitCount: units.length,
    coveredCount,
    coverageRatio: units.length === 0 ? 0 : coveredCount / units.length,
    units,
    uncovered,
    anchorFailures,
    topicCoverage,
  };
}

function covers(claim: string, unit: string): boolean {
  if (unit.trim().length === 0) return true;
  return similarity(claim, unit) >= COVERAGE_SIMILARITY_THRESHOLD;
}

export function coverageSummary(report: CoverageReport): string {
  const percent = Math.round(report.coverageRatio * 100);
  const missingTopics = report.topicCoverage.filter((topic) => !topic.covered).length;
  const parts = [`材料要点覆盖 ${report.coveredCount}/${report.unitCount}（${percent}%）`];
  if (missingTopics > 0) parts.push(`${missingTopics} 个知识点没有出题`);
  if (report.anchorFailures.length > 0) parts.push(`${report.anchorFailures.length} 处出处无法定位`);
  return parts.join(" · ");
}
