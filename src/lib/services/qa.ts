import { ASK_MAX_QUESTION_CHARS, ASK_MIN_EVIDENCE, ASK_TOP_K } from "@/lib/config";
import type { UserRecord } from "@/lib/db/types";
import { ValidationError } from "@/lib/errors";
import { pageAt } from "@/lib/ingest";
import { resolveChatProvider } from "@/lib/llm/provider";
import { countModelSupplements, verifyCitations } from "@/lib/qa/citations";
import {
  ASK_SYSTEM_PROMPT,
  EXTRACTIVE_NOTICE,
  INSUFFICIENT_ANSWER,
  buildAskUserPrompt,
} from "@/lib/qa/prompt";
import type { QaAnswer, QaIssue } from "@/lib/qa/types";
import { assertQuota, recordUsage } from "@/lib/quota";
import { retrieveEvidence, type RetrievalResult } from "@/lib/retrieval";
import { scanMaterial } from "@/lib/security/untrusted";
import { readByok } from "@/lib/services/byok";
import { getMaterialForUser } from "@/lib/services/materials";
import { recordChatUsage } from "@/lib/services/usage";

/**
 * 材料问答：先检索证据，再让模型带着编号回答，最后逐条校验引注。
 *
 * 三个刻意的取舍：
 * 1. 检索不到证据就直接如实说「材料里没有」，不调用模型，避免用参数记忆编答案；
 * 2. 没有可用模型时降级为「离线摘录」，只摘原文不做生成，绝不假装是回答；
 * 3. 引注不合法（编号越界）会被删掉并记为问题，模型补充必须自带标签。
 */
export async function askMaterialQuestion(
  user: UserRecord,
  materialId: string,
  rawQuestion: string,
): Promise<QaAnswer> {
  const question = rawQuestion.trim();
  if (!question) throw new ValidationError("请先输入问题");
  if (question.length > ASK_MAX_QUESTION_CHARS) {
    throw new ValidationError(`问题太长，最多 ${ASK_MAX_QUESTION_CHARS} 个字符。`);
  }

  const material = await getMaterialForUser(user, materialId);
  const started = Date.now();
  const retrieval = retrieveEvidence(material.rawText, question, { topK: ASK_TOP_K });
  const termCoverage =
    retrieval.queryTermCount === 0 ? 0 : retrieval.matchedTermCount / retrieval.queryTermCount;

  const base = {
    question,
    materialId: material.id,
    materialTitle: material.title,
    retrievedCount: retrieval.evidence.length,
    termCoverage,
  };

  // 检索不到任何证据：如实拒绝，不消耗额度，也不给模型编的机会
  if (retrieval.evidence.length < ASK_MIN_EVIDENCE) {
    return {
      ...base,
      answer: INSUFFICIENT_ANSWER,
      citations: [],
      mode: "refused",
      model: "retrieval-only",
      engineMode: "offline",
      insufficient: true,
      issues: [
        {
          kind: "insufficient_evidence",
          detail: "材料里找不到与问题相关的句子，已停止生成。可以换个说法，或先补充材料。",
        },
      ],
      citedCount: 0,
      latencyMs: Date.now() - started,
    };
  }

  const selection = resolveChatProvider(readByok(user)?.llm ?? null);
  if (!selection.provider) {
    return {
      ...base,
      ...extractiveAnswer(retrieval, material.sourceMap),
      model: "extractive-only",
      engineMode: "offline",
      latencyMs: Date.now() - started,
    };
  }

  if (selection.countsAgainstQuota) await assertQuota(user.id, { ask: 1 });

  // 证据先用安全版本拼提示词（中和分隔符），但校验与展示仍用原文
  const safeEvidence = retrieval.evidence.map((unit) => ({
    ...unit,
    text: scanMaterial(unit.text, { maxChars: 2000 }).promptText,
  }));

  const response = await selection.provider.complete({
    system: ASK_SYSTEM_PROMPT,
    user: buildAskUserPrompt({ question, evidence: safeEvidence }),
    temperature: 0.2,
    maxTokens: 1200,
  });

  if (selection.countsAgainstQuota) await recordUsage(user.id, { ask: 1 });

  await recordChatUsage(user.id, [
    {
      model: response.model,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
    },
  ]);

  const check = verifyCitations(response.text.trim(), retrieval.evidence, {
    pageOf: (charOffset) => pageAt(material.sourceMap, charOffset),
  });
  const issues: QaIssue[] = [...check.issues];

  const supplements = countModelSupplements(check.answer);
  if (supplements > 0) {
    issues.push({
      kind: "model_supplement",
      detail: `回答里有 ${supplements} 处「模型补充」，是材料之外的内容，不能当作原文引用。`,
    });
  }

  const insufficient = /材料(里|中)没有(直接)?(说明|提到|涉及)/.test(check.answer);
  if (insufficient) {
    issues.push({
      kind: "insufficient_evidence",
      detail: "模型认为材料不足以回答这个问题，请把「材料里没有」的结论与补充内容分开看。",
    });
  }

  return {
    ...base,
    answer: check.answer,
    citations: check.citations,
    mode: "llm",
    model: response.model,
    engineMode: selection.mode === "byok" ? "byok" : "platform",
    insufficient,
    issues,
    citedCount: check.citedCount,
    latencyMs: Date.now() - started,
  };
}

/** 无模型时的降级：只摘原文，编号与出处仍按同一套契约给出。 */
function extractiveAnswer(
  retrieval: RetrievalResult,
  sourceMap: Parameters<typeof pageAt>[0],
): Pick<QaAnswer, "answer" | "citations" | "mode" | "insufficient" | "issues" | "citedCount"> {
  const answer = [
    EXTRACTIVE_NOTICE,
    "",
    ...retrieval.evidence.map((unit, index) => `[${index + 1}] ${unit.text}`),
  ].join("\n");

  const citations = retrieval.evidence.map((unit, index) => ({
    marker: index + 1,
    unitIndex: unit.unitIndex,
    text: unit.text,
    charStart: unit.charStart,
    charEnd: unit.charEnd,
    page: pageAt(sourceMap, unit.charStart),
    score: unit.score,
  }));

  return {
    answer,
    citations,
    mode: "extractive",
    insufficient: false,
    // 摘录模式下每条都是原文，没有「未标注出处」的问题需要提示
    issues: [],
    citedCount: citations.length,
  };
}
