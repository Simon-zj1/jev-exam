import { APP_NAME } from "@/lib/config";
import type { QuestionType } from "@/lib/config";
import { coverageSummary, type CoverageReport } from "@/lib/coverage";
import type { AnswerPayload } from "@/lib/grading";
import { locateSource, type ProvenanceViolation, type SourceLocation } from "@/lib/provenance";
import { escapeHtml, type Hazard } from "@/lib/security/untrusted";
import type {
  GeneratedQuestion,
  Judgment,
  JudgmentPenalty,
  JudgmentPoint,
  RubricPoint,
} from "@/lib/types";

export const REPORT_VERSION = 1;

export type StudyReportQuestion = {
  position: number;
  id: string;
  type: QuestionType;
  topicId: string;
  topicTitle: string;
  stem: string;
  options: string[] | null;
  sourceAnchor: string;
  sourceLocation: SourceLocation;
  answer: string;
  referenceAnswer: string;
  rubric: RubricPoint[];
  explanation: string | null;
  judgment: {
    method: Judgment["method"];
    score: number;
    scorePercent: number;
    confidence: number;
    needsReview: boolean;
    reviewReasons: string[];
    scoreRange: [number, number] | null;
    points: JudgmentPoint[];
    penalties: JudgmentPenalty[];
    engineId: string;
    model: string;
    latencyMs: number;
  };
};

export type StudyReport = {
  version: number;
  app: string;
  generatedAt: string;
  material: {
    title: string;
    charCount: number;
    unitCount: number;
    hazards: Hazard[];
  };
  exam: {
    title: string;
    generator: string;
    questionCount: number;
  };
  engine: { id: string; model: string; mode: string };
  summary: {
    scorePercent: number;
    needsReviewCount: number;
    objectiveCorrect: number;
    objectiveTotal: number;
  };
  coverage: CoverageReport;
  provenanceViolations: ProvenanceViolation[];
  questions: StudyReportQuestion[];
};

export type BuildReportInput = {
  material: { title: string; rawText: string };
  topics: { id: string; title: string }[];
  questions: GeneratedQuestion[];
  answers: Map<string, AnswerPayload | null>;
  judgments: Map<string, Judgment>;
  coverage: CoverageReport;
  provenanceViolations: ProvenanceViolation[];
  engine: { id: string; model: string; mode: string };
  generator: string;
  examTitle: string;
  generatedAt?: string;
};

export function buildStudyReport(input: BuildReportInput): StudyReport {
  const questionViews: StudyReportQuestion[] = input.questions.map((question, index) => {
    const judgment = input.judgments.get(question.id);
    const topicTitle =
      input.topics.find((topic) => topic.id === question.topic_id)?.title ?? question.topic_id;
    return {
      position: index + 1,
      id: question.id,
      type: question.type,
      topicId: question.topic_id,
      topicTitle,
      stem: question.stem,
      options: question.type === "mcq" ? question.options : null,
      sourceAnchor: question.source_anchor,
      sourceLocation: locateSource(input.material.rawText, question.source_anchor),
      answer: formatAnswer(question, input.answers.get(question.id) ?? null),
      referenceAnswer: referenceAnswerFor(question),
      rubric: question.type === "short_answer" ? question.rubric_points : [],
      explanation: question.explanation ?? null,
      judgment: judgment
        ? {
            method: judgment.method,
            score: judgment.score,
            scorePercent: judgment.scorePercent,
            confidence: judgment.confidence,
            needsReview: judgment.needsReview,
            reviewReasons: judgment.reviewReasons,
            scoreRange: judgment.scoreRange ?? null,
            points: judgment.points,
            penalties: judgment.penalties,
            engineId: judgment.engineId,
            model: judgment.model,
            latencyMs: judgment.latencyMs,
          }
        : {
            method: "exact",
            score: 0,
            scorePercent: 0,
            confidence: 0,
            needsReview: true,
            reviewReasons: ["not_graded"],
            scoreRange: null,
            points: [],
            penalties: [],
            engineId: "none",
            model: "none",
            latencyMs: 0,
          },
    };
  });

  const scored = questionViews.filter((view) => view.judgment.reviewReasons[0] !== "not_graded");
  const objective = questionViews.filter((view) => view.type !== "short_answer");
  const scorePercent = scored.length
    ? Math.round(scored.reduce((sum, view) => sum + view.judgment.score, 0) / scored.length * 100)
    : 0;

  return {
    version: REPORT_VERSION,
    app: APP_NAME,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    material: {
      title: input.material.title,
      charCount: input.material.rawText.length,
      unitCount: input.coverage.unitCount,
      hazards: [],
    },
    exam: {
      title: input.examTitle,
      generator: input.generator,
      questionCount: questionViews.length,
    },
    engine: input.engine,
    summary: {
      scorePercent,
      needsReviewCount: questionViews.filter((view) => view.judgment.needsReview).length,
      objectiveCorrect: objective.filter((view) => view.judgment.scorePercent >= 60).length,
      objectiveTotal: objective.length,
    },
    coverage: input.coverage,
    provenanceViolations: input.provenanceViolations,
    questions: questionViews,
  };
}

export function formatAnswer(question: GeneratedQuestion, payload: AnswerPayload | null): string {
  if (!payload) return "（未作答）";
  switch (payload.type) {
    case "mcq": {
      if (payload.index === null) return "（未作答）";
      const option = question.type === "mcq" ? question.options[payload.index] : undefined;
      return option ? `${String.fromCharCode(65 + payload.index)}. ${option}` : "（选项缺失）";
    }
    case "true_false":
      return payload.value === null ? "（未作答）" : payload.value ? "正确" : "错误";
    case "cloze":
    case "short_answer":
      return payload.text.trim().length > 0 ? payload.text : "（未作答）";
  }
}

export function referenceAnswerFor(question: GeneratedQuestion): string {
  switch (question.type) {
    case "mcq":
      return `${String.fromCharCode(65 + question.correct_index)}. ${
        question.options[question.correct_index] ?? ""
      }`;
    case "true_false":
      return question.answer ? "正确" : "错误";
    case "cloze":
      return question.accepted.length > 1
        ? `${question.answer}（可接受：${question.accepted.join("/")}）`
        : question.answer;
    case "short_answer":
      return question.reference_answer;
  }
}

export function renderReportHtml(report: StudyReport, options: { title?: string } = {}): string {
  const title = options.title ?? `${report.material.title} · 判定报告`;
  const esc = escapeHtml;

  const questions = report.questions
    .map((view) => {
      const status = view.judgment.needsReview
        ? `<span class="badge badge--warn">待复核</span>`
        : `<span class="badge ${view.judgment.scorePercent >= 60 ? "badge--ok" : "badge--err"}">${view.judgment.scorePercent} 分</span>`;

      const pointRows = view.judgment.points
        .map(
          (point) => `<tr>
        <td>${esc(point.statement)}</td>
        <td class="num">${point.weight}</td>
        <td class="num">${point.probability.toFixed(2)}</td>
        <td class="num">${point.strength.toFixed(2)}</td>
        <td>${point.awarded ? "命中" : "未命中"}</td>
      </tr>`,
        )
        .join("");

      const penaltyBlock =
        view.judgment.penalties.length > 0
          ? `<p class="penalty">代码侧扣分：${view.judgment.penalties
              .map(
                (penalty) =>
                  `${esc(penalty.label)}（概率 ${penalty.probability.toFixed(2)}，系数 ${penalty.weight}）`,
              )
              .join("；")}</p>`
          : "";

      const reviewBlock = view.judgment.needsReview
        ? `<p class="review">待复核${
            view.judgment.scoreRange
              ? `，分数区间 ${Math.round(view.judgment.scoreRange[0] * 100)}–${Math.round(
                  view.judgment.scoreRange[1] * 100,
                )} 分`
              : ""
          }：${esc(view.judgment.reviewReasons.join("；") || "低置信度")}</p>`
        : "";

      const sourceLabel = view.sourceLocation.found
        ? view.sourceLocation.unitIndex !== null
          ? `第 ${view.sourceLocation.unitIndex + 1} 句 / 共 ${view.sourceLocation.unitCount} 句`
          : `共 ${view.sourceLocation.unitCount} 句`
        : "未定位";

      return `<section class="q">
      <header class="q__head">
        <span class="q__index">${view.position}</span>
        <span class="badge">${esc(view.topicTitle)}</span>
        ${status}
        <span class="meta">${esc(view.judgment.engineId)} · ${esc(view.judgment.model)}</span>
      </header>
      <p class="q__stem">${esc(view.stem)}</p>
      <div class="grid2">
        <div><h4>你的作答</h4><p>${esc(view.answer)}</p></div>
        <div><h4>参考答案 <span class="tag tag--model">模型补充</span></h4><p>${esc(view.referenceAnswer)}</p></div>
      </div>
      ${reviewBlock}
      ${
        pointRows
          ? `<table class="points">
        <caption>逐点判定（这就是“为什么得这个分”的全部依据）</caption>
        <thead><tr><th>得分点 <span class="tag tag--model">模型补充</span></th><th>权重</th><th>命中概率</th><th>判定强度</th><th>结果</th></tr></thead>
        <tbody>${pointRows}</tbody>
      </table>`
          : ""
      }
      ${penaltyBlock}
      ${
        view.explanation
          ? `<p class="explanation"><span class="tag tag--model">模型补充</span> ${esc(view.explanation)}</p>`
          : ""
      }
      <details class="source">
        <summary>原文出处 · ${esc(sourceLabel)} <span class="tag tag--material">材料原文</span></summary>
        <blockquote>${esc(view.sourceAnchor)}</blockquote>
        ${
          view.rubric.length > 0
            ? `<ul class="rubric-ref">${view.rubric
                .map(
                  (point) =>
                    `<li><span class="tag tag--material">材料原文</span> ${esc(point.evidence_span)}</li>`,
                )
                .join("")}</ul>`
            : ""
        }
      </details>
    </section>`;
    })
    .join("\n");

  const uncovered =
    report.coverage.uncovered.length > 0
      ? `<ul class="uncovered">${report.coverage.uncovered
          .map((unit) => `<li>第 ${unit.index + 1} 句：${esc(unit.text)}</li>`)
          .join("")}</ul>`
      : `<p class="muted">全部材料要点都有题目覆盖。</p>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
:root{--bg:#f5f6f8;--surface:#fff;--text:#15181e;--muted:#5c6472;--line:#e3e6eb;--brand:#2f5bff;--ok:#12805c;--warn:#9a6100;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--surface:#171a20;--text:#e9ecf1;--muted:#9aa3b2;--line:#262b34;--brand:#7f9dff;--ok:#4ade9f;--warn:#e2b34a;--err:#ff8b7d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 6px}
h2{font-size:19px;margin:32px 0 12px}
h4{font-size:13px;color:var(--muted);margin:0 0 4px;font-weight:600}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px}
.score{font-size:34px;font-weight:700;line-height:1.1}
.muted{color:var(--muted)}
.meta{color:var(--muted);font-size:12px;margin-left:auto}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;background:color-mix(in srgb,var(--brand) 12%,transparent);color:var(--brand);border:1px solid color-mix(in srgb,var(--brand) 30%,transparent)}
.badge--ok{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok);border-color:color-mix(in srgb,var(--ok) 30%,transparent)}
.badge--warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn);border-color:color-mix(in srgb,var(--warn) 32%,transparent)}
.badge--err{background:color-mix(in srgb,var(--err) 14%,transparent);color:var(--err);border-color:color-mix(in srgb,var(--err) 30%,transparent)}
.tag{font-size:11px;padding:1px 7px;border-radius:6px;border:1px solid var(--line);color:var(--muted);margin-left:4px;vertical-align:middle}
.tag--material{border-color:color-mix(in srgb,var(--ok) 40%,transparent);color:var(--ok)}
.tag--model{border-color:color-mix(in srgb,var(--brand) 40%,transparent);color:var(--brand)}
.q{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
.q__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.q__index{font-weight:700;color:var(--brand)}
.q__stem{margin:0 0 10px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13.5px}
caption{caption-side:top;text-align:left;color:var(--muted);font-size:12.5px;padding-bottom:6px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12.5px}
.num{font-variant-numeric:tabular-nums}
.review{background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,transparent);color:var(--warn);padding:8px 12px;border-radius:10px;font-size:13px;margin:12px 0 0}
.penalty{background:color-mix(in srgb,var(--err) 10%,transparent);border:1px solid color-mix(in srgb,var(--err) 26%,transparent);color:var(--err);padding:8px 12px;border-radius:10px;font-size:13px}
.explanation{color:var(--muted);font-size:13px}
details.source{margin-top:12px;font-size:13px}
details.source summary{cursor:pointer;color:var(--muted)}
blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--line);color:var(--muted)}
.rubric-ref{margin:8px 0 0;padding-left:18px;color:var(--muted)}
.uncovered{margin:8px 0 0;padding-left:18px;color:var(--warn);font-size:13.5px}
.foot{margin-top:28px;color:var(--muted);font-size:12.5px}
@media print{.q,.card{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  <p class="muted">由 ${esc(report.app)} 生成 · ${esc(report.generatedAt)} · 判定引擎 ${esc(
    report.engine.id,
  )} / ${esc(report.engine.model)}（${esc(report.engine.mode)}）</p>

  <section class="card summary">
    <div><div class="muted">总分</div><div class="score">${report.summary.scorePercent}<span class="muted" style="font-size:14px"> / 100</span></div></div>
    <div><div class="muted">待复核</div><div class="score">${report.summary.needsReviewCount}</div></div>
    <div><div class="muted">客观题正确</div><div class="score">${report.summary.objectiveCorrect}<span class="muted" style="font-size:14px"> / ${
      report.summary.objectiveTotal
    }</span></div></div>
  </section>

  <section class="card">
    <h2 style="margin-top:0">材料与覆盖</h2>
    <p>${esc(report.material.title)} · ${report.material.charCount} 字符 · ${report.material.unitCount} 个要点</p>
    <p>${esc(coverageSummary(report.coverage))}</p>
    <p class="muted">未覆盖的材料要点（如实列出，不代表题目有错）：</p>
    ${uncovered}
    ${
      report.provenanceViolations.length > 0
        ? `<p class="penalty">溯源契约未通过 ${report.provenanceViolations.length} 处：${esc(
            report.provenanceViolations
              .slice(0, 5)
              .map((violation) => `${violation.questionId}.${violation.field}`)
              .join("、"),
          )}</p>`
        : `<p class="muted">溯源契约：所有「材料原文」字段均可在原文中定位。</p>`
    }
  </section>

  <h2>逐题判定</h2>
  ${questions}

  <p class="foot">
    标签说明：<span class="tag tag--material">材料原文</span> 可在材料中逐字定位；
    <span class="tag tag--model">模型补充</span> 由模型生成，措辞可能与原文不同。
    待复核题目的判定强度不足，分数仅供参考，也不计入知识点掌握度。
  </p>
</div>
</body>
</html>`;
}

export function renderReportMarkdown(report: StudyReport): string {
  const lines: string[] = [];
  lines.push(`# ${report.material.title} · 判定报告`);
  lines.push("");
  lines.push(
    `- 生成时间：${report.generatedAt}`,
    `- 判定引擎：${report.engine.id} / ${report.engine.model}（${report.engine.mode}）`,
    `- 出题：${report.exam.generator}`,
    `- 总分：${report.summary.scorePercent} / 100`,
    `- 待复核：${report.summary.needsReviewCount} 题`,
    `- 客观题正确：${report.summary.objectiveCorrect} / ${report.summary.objectiveTotal}`,
    `- ${coverageSummary(report.coverage)}`,
  );
  lines.push("");
  lines.push("## 逐题判定");

  for (const view of report.questions) {
    lines.push("");
    lines.push(
      `### ${view.position}. [${view.topicTitle}] ${view.stem}（${
        view.judgment.needsReview ? "待复核" : `${view.judgment.scorePercent} 分`
      }）`,
    );
    lines.push("");
    lines.push(`- 你的作答：${view.answer}`);
    lines.push(`- 参考答案（模型补充）：${view.referenceAnswer}`);
    if (view.judgment.points.length > 0) {
      lines.push("");
      lines.push("| 得分点（模型补充） | 权重 | 命中概率 | 判定强度 | 结果 |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const point of view.judgment.points) {
        lines.push(
          `| ${point.statement} | ${point.weight} | ${point.probability.toFixed(2)} | ${point.strength.toFixed(
            2,
          )} | ${point.awarded ? "命中" : "未命中"} |`,
        );
      }
    }
    if (view.judgment.needsReview) {
      lines.push("");
      lines.push(
        `> 待复核${view.judgment.scoreRange ? `：分数区间 ${Math.round(view.judgment.scoreRange[0] * 100)}–${Math.round(view.judgment.scoreRange[1] * 100)} 分` : ""}。原因：${view.judgment.reviewReasons.join("；")}`,
      );
    }
    lines.push("");
    lines.push(
      `<details><summary>原文出处（材料原文）</summary>\n\n> ${view.sourceAnchor}\n\n</details>`,
    );
  }

  if (report.coverage.uncovered.length > 0) {
    lines.push("");
    lines.push("## 未覆盖的材料要点");
    lines.push("");
    for (const unit of report.coverage.uncovered) {
      lines.push(`- 第 ${unit.index + 1} 句：${unit.text}`);
    }
  }

  return lines.join("\n");
}
