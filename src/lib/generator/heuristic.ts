import { createHash } from "node:crypto";
import { truncate } from "@/lib/text";
import type {
  GeneratedQuestion,
  Outline,
  Topic,
} from "@/lib/types";
import type { GenerationProvider, OutlineRequest, QuestionRequest } from "@/lib/generator/provider";

/**
 * 离线确定性出题器（offline-heuristic）。
 *
 * 没有配置平台出题模型时使用：从材料分句、切分知识点、拼出四种题型。
 * 题目质量明显低于 LLM 出题，仅用于把闭环跑通与自动化测试。
 */
export class HeuristicGenerationProvider implements GenerationProvider {
  readonly id = "offline-heuristic";
  readonly model = "offline-heuristic-v1";
  readonly origin = "offline" as const;

  async generateOutline(request: OutlineRequest): Promise<Outline> {
    const sentences = splitSentences(request.materialText);
    const topicCount = Math.max(1, Math.min(request.topicCount, Math.ceil(sentences.length / 2) || 1));
    const groupSize = Math.max(1, Math.ceil(sentences.length / topicCount));

    const topics: Topic[] = [];
    for (let index = 0; index < sentences.length && topics.length < topicCount; index += groupSize) {
      const group = sentences.slice(index, index + groupSize);
      const first = group[0] ?? "";
      topics.push({
        id: `t${topics.length + 1}`,
        title: truncate(first.replace(/[。！？.!?]+$/, ""), 28) || `知识点 ${topics.length + 1}`,
        summary: truncate(group.slice(0, 3).join(" "), 200),
        source_spans: group.slice(0, 4),
      });
    }

    if (topics.length === 0) {
      topics.push({
        id: "t1",
        title: "材料要点",
        summary: truncate(request.materialText, 200),
        source_spans: [truncate(request.materialText, 400)],
      });
    }

    return { topics, generatorModel: this.model };
  }

  async generateQuestions(request: QuestionRequest): Promise<{
    questions: GeneratedQuestion[];
    model: string;
    raw: unknown;
  }> {
    const questions: GeneratedQuestion[] = [];
    const quota = allocate(request.mix, request.count);
    const topics = request.topics;
    const allSentences = topics.flatMap((topic) =>
      topic.source_spans.map((span) => ({ topic, sentence: span })),
    );

    let cursor = 0;
    const take = (type: keyof typeof quota) => {
      for (let attempt = 0; attempt < topics.length * 4; attempt += 1) {
        const topic = topics[cursor % topics.length];
        cursor += 1;
        if (!topic) continue;
        if (quota[type] <= 0) return null;
        const sentence = topic.source_spans[(cursor + attempt) % topic.source_spans.length] ?? "";
        if (sentence.length < 8) continue;
        quota[type] -= 1;
        return { topic, sentence };
      }
      return null;
    };

    while (quota.mcq > 0) {
      const picked = take("mcq");
      if (!picked) break;
      const distractors = allSentences
        .filter((entry) => entry.topic.id !== picked.topic.id && entry.sentence !== picked.sentence)
        .slice(0, 3)
        .map((entry) => truncate(entry.sentence, 60));
      const options = [truncate(picked.sentence, 60), ...distractors];
      if (options.length < 4) break;
      questions.push({
        id: questionId(`mcq|${picked.sentence}`),
        topic_id: picked.topic.id,
        type: "mcq",
        stem: `关于「${truncate(picked.topic.title, 24)}」，下列哪一项与材料中的描述一致？`,
        options,
        correct_index: 0,
        difficulty: "medium",
        source_anchor: picked.sentence,
        explanation: "正确选项直接取自材料原文，其余选项来自其它知识点。",
      });
    }

    while (quota.true_false > 0) {
      const picked = take("true_false");
      if (!picked) break;
      const useTrue = questions.length % 2 === 0;
      const foreign = allSentences.find((entry) => entry.topic.id !== picked.topic.id);
      const statement = useTrue || !foreign ? truncate(picked.sentence, 80) : truncate(foreign.sentence, 80);
      questions.push({
        id: questionId(`tf|${statement}|${useTrue}`),
        topic_id: picked.topic.id,
        type: "true_false",
        stem: `判断：${statement}`,
        answer: useTrue || !foreign,
        difficulty: "easy",
        source_anchor: useTrue || !foreign ? picked.sentence : foreign.sentence,
        explanation: useTrue || !foreign ? "该表述与材料一致。" : "该表述来自材料中的其它知识点，与本题主题不符。",
      });
    }

    while (quota.cloze > 0) {
      const picked = take("cloze");
      if (!picked) break;
      const term = pickKeyTerm(picked.sentence);
      if (!term) break;
      questions.push({
        id: questionId(`cloze|${picked.sentence}|${term}`),
        topic_id: picked.topic.id,
        type: "cloze",
        stem: "请补全材料中的关键表述。",
        text_with_blank: picked.sentence.replace(term, "____"),
        answer: term,
        accepted: [term],
        difficulty: "medium",
        source_anchor: picked.sentence,
      });
    }

    while (quota.short_answer > 0) {
      const topic = topics[cursor % topics.length];
      cursor += 1;
      if (!topic) break;
      quota.short_answer -= 1;
      const spans = topic.source_spans.slice(0, 5);
      const rubric_points = spans.map((span, index) => ({
        point_id: `p${index + 1}`,
        statement: `答案提到该要点：${truncate(span, 80)}`,
        weight: 1,
        evidence_span: span,
      }));
      if (rubric_points.length < 3) break;
      questions.push({
        id: questionId(`sa|${topic.id}|${topic.title}`),
        topic_id: topic.id,
        type: "short_answer",
        stem: `请根据材料说明「${truncate(topic.title, 24)}」的要点。`,
        reference_answer: truncate(spans.join(" "), 600),
        rubric_points,
        difficulty: "medium",
        source_anchor: spans[0] ?? topic.summary,
        explanation: "每个要点对应一条判定问题，按权重合成得分。",
      });
    }

    return { questions, model: this.model, raw: { provider: this.id } };
  }
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
}

function pickKeyTerm(sentence: string): string | null {
  const latin = sentence.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) ?? [];
  if (latin.length > 0) {
    const sorted = [...latin].sort((a, b) => b.length - a.length);
    return sorted[0] ?? null;
  }
  const han = sentence.match(/[\u4e00-\u9fff]{3,8}/g) ?? [];
  if (han.length > 0) {
    const sorted = [...han].sort((a, b) => b.length - a.length);
    return sorted[0] ?? null;
  }
  return null;
}

export function allocate(
  mix: Record<string, number>,
  count: number,
): Record<string, number> {
  const entries = Object.entries(mix).filter(([, value]) => value > 0);
  if (entries.length === 0) return { mcq: count };
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const result: Record<string, number> = {};
  let assigned = 0;
  entries.forEach(([type, value], index) => {
    const raw = index === entries.length - 1 ? count - assigned : Math.floor((value / total) * count);
    result[type] = Math.max(0, raw);
    assigned += result[type];
  });
  return result;
}

export function questionId(seed: string): string {
  return `q_${createHash("sha1").update(seed).digest("hex").slice(0, 10)}`;
}
