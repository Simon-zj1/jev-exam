import type { JudgmentRecord, QuestionRecord } from "@/lib/db/types";
import type { AnswerPayload } from "@/lib/grading";

export function formatAnswer(question: QuestionRecord, payload: AnswerPayload | null): string {
  if (!payload) return "（未作答）";
  switch (payload.type) {
    case "mcq": {
      if (payload.index === null) return "（未作答）";
      const option = question.options?.[payload.index];
      return option ? `${String.fromCharCode(65 + payload.index)}. ${option}` : "（选项缺失）";
    }
    case "true_false":
      return payload.value === null ? "（未作答）" : payload.value ? "正确" : "错误";
    case "cloze":
    case "short_answer":
      return payload.text.trim().length > 0 ? payload.text : "（未作答）";
  }
}

export function formatCorrectAnswer(question: QuestionRecord): string {
  switch (question.type) {
    case "mcq": {
      const index = question.answerKey.mcq?.correct_index ?? 0;
      const option = question.options?.[index];
      return option ? `${String.fromCharCode(65 + index)}. ${option}` : "—";
    }
    case "true_false":
      return question.answerKey.true_false?.answer ? "正确" : "错误";
    case "cloze": {
      const answer = question.answerKey.cloze?.answer ?? "";
      const accepted = question.answerKey.cloze?.accepted ?? [];
      return accepted.length > 1 ? `${answer}（可接受：${accepted.join("/")}）` : answer;
    }
    case "short_answer":
      return question.answerKey.short_answer?.reference_answer ?? "—";
  }
}

export function formatEngine(judgment: JudgmentRecord): string {
  const methodLabel =
    judgment.method === "exact"
      ? "确定性判分"
      : judgment.method === "semantic"
        ? "语义等价判定"
        : "逐点判定";
  return `${methodLabel} · ${judgment.engineId} · ${judgment.model}`;
}

export function formatReviewReason(reason: string): string {
  if (reason === "semantic_check_unavailable") return "没有可用的语义判定引擎，填空题只能做字面比对";
  if (reason === "engine_unavailable") return "判定引擎不可用，本题未判分";
  if (reason === "low_confidence_contradiction_check") return "“是否矛盾”这项检查置信度不足";
  if (reason === "low_confidence_fabrication_check") return "“是否编造”这项检查置信度不足";
  if (reason === "low_confidence_semantic_match") return "填空题语义等价判定置信度不足";
  if (reason.startsWith("low_confidence_point:")) {
    return `得分点 ${reason.split(":")[1]} 判定强度不足`;
  }
  return reason;
}

export function scoreTone(percent: number): "ok" | "warn" | "err" {
  if (percent >= 80) return "ok";
  if (percent >= 60) return "warn";
  return "err";
}
