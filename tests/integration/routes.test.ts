import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as materialsRoute, POST as createMaterialRoute } from "@/app/api/materials/route";
import { GET as materialDetailRoute } from "@/app/api/materials/[id]/route";
import { POST as outlineRoute } from "@/app/api/materials/[id]/outline/route";
import { POST as extractRoute } from "@/app/api/materials/extract/route";
import { POST as askRoute } from "@/app/api/materials/[id]/ask/route";
import { POST as createExamRoute } from "@/app/api/exams/route";
import { GET as examRoute } from "@/app/api/exams/[id]/route";
import { POST as submitRoute } from "@/app/api/exams/[id]/submit/route";
import { GET as attemptRoute } from "@/app/api/attempts/[id]/route";
import { GET as meRoute } from "@/app/api/me/route";
import { POST as judgeRoute } from "@/app/api/exams/[id]/judge/route";
import { POST as finalizeRoute } from "@/app/api/exams/[id]/finalize/route";
import { GET as reviewsRoute } from "@/app/api/reviews/route";
import { POST as reviewGradeRoute } from "@/app/api/reviews/grade/route";
import { GET as exportBackupRoute } from "@/app/api/export/backup/route";
import { GET as exportAnkiRoute } from "@/app/api/export/anki/route";
import { GET as exportMarkdownRoute } from "@/app/api/export/markdown/route";
import { GET as feedbackRoute, POST as feedbackPostRoute } from "@/app/api/feedback/route";
import { DELETE as deleteAccountRoute } from "@/app/api/account/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { resetRateLimits } from "@/lib/rate-limit";
import { QUOTA_LIMITS } from "@/lib/config";
import { getStore } from "@/lib/db";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { setChatProviderOverride } from "@/lib/llm/provider";
import {
  FakeChatProvider,
  FakeEngine,
  SAMPLE_MATERIAL,
  noul,
  resetOverrides,
  useMemoryStore,
} from "../helpers";

function jsonRequest(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function multipartRequest(
  path: string,
  file: { bytes: Uint8Array; name: string; type: string },
  cookie?: string,
): NextRequest {
  const form = new FormData();
  form.append("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers, body: form });
}

function cookieFrom(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = raw.match(/jev_session=([^;]+)/);
  if (!match) throw new Error(`响应中没有会话 Cookie：${raw}`);
  return `jev_session=${match[1]}`;
}

async function login(email: string, inviteCode?: string) {
  const response = await loginRoute(
    jsonRequest("/api/auth/login", { method: "POST", body: { email, inviteCode } }),
  );
  return { response, cookie: response.ok ? cookieFrom(response) : "" };
}

describe("HTTP 层（路由处理器）", () => {
  beforeEach(async () => {
    useMemoryStore();
    // 限流计数存在进程内存里，用例之间必须清空，否则会互相干扰
    resetRateLimits();
    setGenerationProviderOverride(new HeuristicGenerationProvider());
    setDecisionEngineOverride(
      new FakeEngine((_state, questions) => {
        const answers: Record<string, ReturnType<typeof noul>> = {};
        for (const key of Object.keys(questions)) {
          answers[key] = key.startsWith("point_") ? noul(0.9) : noul(0.05);
        }
        return answers;
      }),
    );
    await getStore().upsertInviteCode("HTTP-CODE", 10);
  });

  afterEach(() => resetOverrides());

  it("健康检查不泄露用户数据，且说明当前引擎", async () => {
    const response = await healthRoute();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      store: string;
      engines: { judge: string; demoMode: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.store).toBe("memory");
    expect(body.engines.judge).toBeTruthy();
    // 健康检查是公开接口，不能带上任何账号或材料信息
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("登录接口有限流，防止邀请码被无限次试", async () => {
    const attempt = () =>
      loginRoute(
        jsonRequest("/api/auth/login", {
          method: "POST",
          body: { email: "bruteforce@example.com", inviteCode: "WRONG" },
        }),
      );

    let limited = 0;
    for (let index = 0; index < 14; index += 1) {
      const response = await attempt();
      if (response.status === 429) {
        limited += 1;
        if (limited === 1) {
          expect(response.headers.get("retry-after")).toBeTruthy();
          const body = (await response.json()) as { code: string };
          expect(body.code).toBe("rate_limited");
        }
      }
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("未登录时所有业务接口返回 401", async () => {
    for (const response of [
      await materialsRoute(jsonRequest("/api/materials")),
      await createMaterialRoute(jsonRequest("/api/materials", { method: "POST", body: {} })),
      await meRoute(jsonRequest("/api/me")),
      await judgeRoute(
        jsonRequest("/api/exams/exam_x/judge", {
          method: "POST",
          body: { questionId: "q1", payload: null },
        }),
        params("exam_x"),
      ),
      await finalizeRoute(
        jsonRequest("/api/exams/exam_x/finalize", { method: "POST" }),
        params("exam_x"),
      ),
      await reviewsRoute(jsonRequest("/api/reviews")),
      await reviewGradeRoute(
        jsonRequest("/api/reviews/grade", {
          method: "POST",
          body: { questionId: "q1", payload: null },
        }),
      ),
      await extractRoute(jsonRequest("/api/materials/extract", { method: "POST", body: {} })),
      await askRoute(
        jsonRequest("/api/materials/mat_x/ask", { method: "POST", body: { question: "这是什么？" } }),
        params("mat_x"),
      ),
      await exportBackupRoute(jsonRequest("/api/export/backup")),
      await exportAnkiRoute(jsonRequest("/api/export/anki")),
      await exportMarkdownRoute(jsonRequest("/api/export/markdown")),
      await feedbackRoute(jsonRequest("/api/feedback")),
      await feedbackPostRoute(
        jsonRequest("/api/feedback", {
          method: "POST",
          body: { questionId: "q1", kind: "wrong_score" },
        }),
      ),
      await deleteAccountRoute(
        jsonRequest("/api/account", { method: "DELETE", body: { confirmEmail: "x@example.com" } }),
      ),
    ]) {
      expect(response.status).toBe(401);
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("unauthorized");
    }
  });

  it("逐题判定 + 收卷：与一次性提交等价，重复收卷不会重复计分", async () => {
    const { cookie } = await login("progressive@example.com", "HTTP-CODE");

    const created = await createMaterialRoute(
      jsonRequest("/api/materials", {
        method: "POST",
        cookie,
        body: { title: "渐进判定材料", rawText: SAMPLE_MATERIAL },
      }),
    );
    const materialId = ((await created.json()) as { material: { id: string } }).material.id;
    await outlineRoute(
      jsonRequest(`/api/materials/${materialId}/outline`, { method: "POST", cookie, body: {} }),
      params(materialId),
    );
    const examResponse = await createExamRoute(
      jsonRequest("/api/exams", {
        method: "POST",
        cookie,
        body: { materialId, topicIds: [], count: 6, mix: { mcq: 3, true_false: 2, cloze: 1 } },
      }),
    );
    const examId = ((await examResponse.json()) as { examId: string }).examId;

    const takeBody = (await (
      await examRoute(jsonRequest(`/api/exams/${examId}`, { cookie }), params(examId))
    ).json()) as { questions: { id: string; type: string }[] };
    expect(takeBody.questions.length).toBeGreaterThan(0);

    // 逐题判定：每题一次请求，返回可立即展示的结论
    for (const question of takeBody.questions) {
      const payload =
        question.type === "mcq"
          ? { type: "mcq", index: 0 }
          : question.type === "true_false"
            ? { type: "true_false", value: true }
            : { type: "cloze", text: "光反应" };
      const judged = await judgeRoute(
        jsonRequest(`/api/exams/${examId}/judge`, {
          method: "POST",
          cookie,
          body: { questionId: question.id, payload },
        }),
        params(examId),
      );
      expect(judged.status).toBe(200);
      const verdict = (await judged.json()) as { questionId: string; scorePercent: number };
      expect(verdict.questionId).toBe(question.id);
      expect(typeof verdict.scorePercent).toBe("number");
    }

    // 不属于这份试卷的题目应被拒绝
    const foreign = await judgeRoute(
      jsonRequest(`/api/exams/${examId}/judge`, {
        method: "POST",
        cookie,
        body: { questionId: "q_not_in_exam", payload: null },
      }),
      params(examId),
    );
    expect(foreign.status).toBe(404);

    const finalized = await finalizeRoute(
      jsonRequest(`/api/exams/${examId}/finalize`, { method: "POST", cookie }),
      params(examId),
    );
    expect(finalized.status).toBe(200);
    const result = (await finalized.json()) as {
      attemptId: string;
      scorePercent: number;
      judgedCount: number;
    };
    expect(result.judgedCount).toBe(takeBody.questions.length);

    // 重复收卷：返回同一条 attempt，分数不变（掌握度不会被重复计入）
    const again = await finalizeRoute(
      jsonRequest(`/api/exams/${examId}/finalize`, { method: "POST", cookie }),
      params(examId),
    );
    const second = (await again.json()) as { attemptId: string; scorePercent: number };
    expect(second.attemptId).toBe(result.attemptId);
    expect(second.scorePercent).toBe(result.scorePercent);

    const report = await attemptRoute(
      jsonRequest(`/api/attempts/${result.attemptId}`, { cookie }),
      params(result.attemptId),
    );
    expect(report.status).toBe(200);
  });

  it("邀请码登录后才可访问，且邀请码错误会被拒绝", async () => {
    const bad = await login("httpcode@example.com", "NOPE");
    expect(bad.response.status).toBe(403);

    const good = await login("httpcode@example.com", "HTTP-CODE");
    expect(good.response.status).toBe(200);

    const materials = await materialsRoute(jsonRequest("/api/materials", { cookie: good.cookie }));
    expect(materials.status).toBe(200);
  });

  it("完整链路：上传 → 大纲 → 出题 → 作答页不泄露答案 → 提交 → 结果", async () => {
    const { cookie } = await login("flow@example.com", "HTTP-CODE");

    const created = await createMaterialRoute(
      jsonRequest("/api/materials", {
        method: "POST",
        cookie,
        body: { title: "生物 · 光合作用", rawText: SAMPLE_MATERIAL },
      }),
    );
    expect(created.status).toBe(201);
    const materialId = ((await created.json()) as { material: { id: string } }).material.id;

    const outline = await outlineRoute(
      jsonRequest(`/api/materials/${materialId}/outline`, { method: "POST", cookie, body: {} }),
      params(materialId),
    );
    expect(outline.status).toBe(200);
    expect(((await outline.json()) as { topics: unknown[] }).topics.length).toBeGreaterThan(0);

    const exam = await createExamRoute(
      jsonRequest("/api/exams", {
        method: "POST",
        cookie,
        body: {
          materialId,
          topicIds: [],
          count: 6,
          mix: { mcq: 2, true_false: 2, cloze: 1, short_answer: 1 },
        },
      }),
    );
    expect(exam.status).toBe(201);
    const examId = ((await exam.json()) as { examId: string }).examId;

    const takeView = await examRoute(jsonRequest(`/api/exams/${examId}`, { cookie }), params(examId));
    expect(takeView.status).toBe(200);
    const takeText = await takeView.text();
    expect(takeText).not.toContain("answerKey");
    expect(takeText).not.toContain("rubricPoints");
    expect(takeText).not.toContain("reference_answer");
    expect(takeText).not.toContain("correct_index");

    const takePayload = JSON.parse(takeText) as {
      questions: { id: string; type: string; options: string[] | null }[];
    };

    const answers = takePayload.questions.map((question) => {
      if (question.type === "mcq") return { questionId: question.id, payload: { type: "mcq", index: 0 } };
      if (question.type === "true_false")
        return { questionId: question.id, payload: { type: "true_false", value: true } };
      if (question.type === "cloze")
        return { questionId: question.id, payload: { type: "cloze", text: "光反应" } };
      return {
        questionId: question.id,
        payload: { type: "short_answer", text: "光反应发生在类囊体薄膜上，需要光照。" },
      };
    });

    const submitted = await submitRoute(
      jsonRequest(`/api/exams/${examId}/submit`, { method: "POST", cookie, body: { answers } }),
      params(examId),
    );
    expect(submitted.status).toBe(200);
    const submission = (await submitted.json()) as {
      attemptId: string;
      scorePercent: number;
      judgedCount: number;
    };
    expect(submission.judgedCount).toBe(takePayload.questions.length);

    const result = await attemptRoute(
      jsonRequest(`/api/attempts/${submission.attemptId}`, { cookie }),
      params(submission.attemptId),
    );
    expect(result.status).toBe(200);
    const resultBody = (await result.json()) as {
      totals: { scorePercent: number; objectiveTotal: number };
      questions: { judgment: unknown }[];
    };
    expect(resultBody.questions).toHaveLength(takePayload.questions.length);
    expect(resultBody.totals.objectiveTotal).toBeGreaterThan(0);
  });

  it("额度用尽后返回 429", async () => {
    const { cookie } = await login("quota@example.com", "HTTP-CODE");

    for (let index = 0; index < QUOTA_LIMITS.material; index += 1) {
      const response = await createMaterialRoute(
        jsonRequest("/api/materials", {
          method: "POST",
          cookie,
          body: { title: `材料 ${index}`, rawText: SAMPLE_MATERIAL },
        }),
      );
      expect(response.status).toBe(201);
    }

    const over = await createMaterialRoute(
      jsonRequest("/api/materials", {
        method: "POST",
        cookie,
        body: { title: "超额材料", rawText: SAMPLE_MATERIAL },
      }),
    );
    expect(over.status).toBe(429);
    const body = (await over.json()) as { code: string; error: string };
    expect(body.code).toBe("quota_exceeded");
    expect(body.error).toContain("额度");
  });

  it("跨用户访问他人材料被拒绝", async () => {
    const owner = await login("owner2@example.com", "HTTP-CODE");
    const intruder = await login("intruder2@example.com", "HTTP-CODE");

    const created = await createMaterialRoute(
      jsonRequest("/api/materials", {
        method: "POST",
        cookie: owner.cookie,
        body: { title: "私有材料", rawText: SAMPLE_MATERIAL },
      }),
    );
    const materialId = ((await created.json()) as { material: { id: string } }).material.id;

    const denied = await materialDetailRoute(
      jsonRequest(`/api/materials/${materialId}`, { cookie: intruder.cookie }),
      params(materialId),
    );
    expect(denied.status).toBe(403);

    const allowed = await materialDetailRoute(
      jsonRequest(`/api/materials/${materialId}`, { cookie: owner.cookie }),
      params(materialId),
    );
    expect(allowed.status).toBe(200);
  });

  it("复习闭环：交卷 → 到期队列 → 判定推进排期 → 自评模式", async () => {
    const { cookie } = await login("review-http@example.com", "HTTP-CODE");

    const created = await createMaterialRoute(
      jsonRequest("/api/materials", {
        method: "POST",
        cookie,
        body: { title: "复习材料", rawText: SAMPLE_MATERIAL },
      }),
    );
    const materialId = ((await created.json()) as { material: { id: string } }).material.id;
    await outlineRoute(
      jsonRequest(`/api/materials/${materialId}/outline`, { method: "POST", cookie, body: {} }),
      params(materialId),
    );
    const examResponse = await createExamRoute(
      jsonRequest("/api/exams", {
        method: "POST",
        cookie,
        body: {
          materialId,
          topicIds: [],
          count: 6,
          mix: { mcq: 2, true_false: 1, cloze: 1, short_answer: 1 },
        },
      }),
    );
    const examId = ((await examResponse.json()) as { examId: string }).examId;

    // 取题目与答案键：HTTP 层的作答视图刻意不泄露答案，所以这里从存储层取
    const questions = await getStore().getQuestions(await getStore().listExamQuestionIds(examId));
    const target = questions.find((question) => question.type !== "short_answer");
    expect(target).toBeDefined();
    if (!target) throw new Error("本题组没有客观题，无法构造确定的错题");

    const payloadFor = (question: (typeof questions)[number], wrong: boolean) => {
      switch (question.type) {
        case "mcq": {
          const correct = question.answerKey.mcq?.correct_index ?? 0;
          const width = question.options?.length ?? 4;
          return { type: "mcq", index: wrong ? (correct + 1) % width : correct };
        }
        case "true_false": {
          const answer = question.answerKey.true_false?.answer ?? true;
          return { type: "true_false", value: wrong ? !answer : answer };
        }
        case "cloze": {
          const answer = question.answerKey.cloze?.answer ?? "";
          return { type: "cloze", text: wrong ? "明显错误的答案" : answer };
        }
        default:
          return {
            type: "short_answer",
            text: "光反应发生在类囊体薄膜上，需要光照，水在光下分解产生氧气。",
          };
      }
    };

    const answers = questions.map((question) => ({
      questionId: question.id,
      payload: payloadFor(question, question.id === target.id),
    }));

    const submitted = await submitRoute(
      jsonRequest(`/api/exams/${examId}/submit`, { method: "POST", cookie, body: { answers } }),
      params(examId),
    );
    expect(submitted.status).toBe(200);

    // 到期队列里应当恰好只有那道错题
    const queue = await reviewsRoute(jsonRequest("/api/reviews", { cookie }));
    expect(queue.status).toBe(200);
    const queueBody = (await queue.json()) as {
      stats: { due: number; total: number };
      cards: { questionId: string }[];
    };
    expect(queueBody.stats.due).toBe(1);
    expect(queueBody.stats.total).toBe(1);
    expect(queueBody.cards.map((card) => card.questionId)).toEqual([target.id]);

    // 复习时答对 → 评分升到 4，排期推到未来
    const graded = await reviewGradeRoute(
      jsonRequest("/api/reviews/grade", {
        method: "POST",
        cookie,
        body: { questionId: target.id, payload: payloadFor(target, false) },
      }),
    );
    expect(graded.status).toBe(200);
    const gradedBody = (await graded.json()) as {
      mode: string;
      rating: number;
      scorePercent: number;
      scheduledDays: number;
      nextDueAt: string;
    };
    expect(gradedBody.mode).toBe("judged");
    expect(gradedBody.scorePercent).toBe(100);
    expect(gradedBody.rating).toBe(4);
    expect(gradedBody.scheduledDays).toBeGreaterThan(0);
    expect(new Date(gradedBody.nextDueAt).getTime()).toBeGreaterThan(Date.now());

    // 队列清空，但卡片仍在（只是排到了未来）
    const afterGrade = (await (
      await reviewsRoute(jsonRequest("/api/reviews", { cookie }))
    ).json()) as { stats: { due: number; total: number } };
    expect(afterGrade.stats.due).toBe(0);
    expect(afterGrade.stats.total).toBe(1);

    // 自评模式：手写作答无法自动判定时，让学习者自己给评分
    const selfReport = await reviewGradeRoute(
      jsonRequest("/api/reviews/grade", {
        method: "POST",
        cookie,
        body: { questionId: target.id, rating: 2 },
      }),
    );
    expect(selfReport.status).toBe(200);
    expect(((await selfReport.json()) as { mode: string }).mode).toBe("self-report");

    // 参数校验：缺 questionId 或评分越界都应是 400
    const missing = await reviewGradeRoute(
      jsonRequest("/api/reviews/grade", {
        method: "POST",
        cookie,
        body: { payload: payloadFor(target, false) },
      }),
    );
    expect(missing.status).toBe(400);
    const badRating = await reviewGradeRoute(
      jsonRequest("/api/reviews/grade", {
        method: "POST",
        cookie,
        body: { questionId: target.id, rating: 9 },
      }),
    );
    expect(badRating.status).toBe(400);
  });

  it("上传解析 → 保存材料 → 就材料提问并带上出处", async () => {
    const { cookie } = await login("uploader@example.com", "HTTP-CODE");
    const pdf = new Uint8Array(
      readFileSync(fileURLToPath(new URL("../fixtures/sample.pdf", import.meta.url))),
    );

    // 1) 解析：只返回文本与页面映射，不落库
    const extracted = await extractRoute(
      multipartRequest(
        "/api/materials/extract",
        { bytes: pdf, name: "RAG 笔记.pdf", type: "application/pdf" },
        cookie,
      ),
    );
    expect(extracted.status).toBe(200);
    const extraction = (await extracted.json()) as {
      extraction: { kind: string; title: string; text: string; pageCount: number };
      sourceMap: { pages: { page: number }[] | null };
    };
    expect(extraction.extraction.kind).toBe("pdf");
    expect(extraction.extraction.title).toBe("RAG 笔记");
    expect(extraction.extraction.pageCount).toBe(2);
    expect(extraction.extraction.text).toContain("Vector search encodes text into vectors");
    expect(extraction.sourceMap.pages?.map((page) => page.page)).toEqual([1, 2]);

    // 2) 保存：网页端把解析结果回填表单后再提交，这里模拟同样的请求
    const saved = await createMaterialRoute(
      jsonRequest("/api/materials", {
        method: "POST",
        cookie,
        body: {
          title: extraction.extraction.title,
          rawText: extraction.extraction.text,
          sourceMap: extraction.sourceMap,
        },
      }),
    );
    expect(saved.status).toBe(201);
    const materialId = ((await saved.json()) as { material: { id: string } }).material.id;

    // 3) 提问：注入假模型，验证引注与页码回填
    setChatProviderOverride(
      new FakeChatProvider(
        () => "向量检索把文本编码成向量，用相似度做语义召回[1]。",
      ),
    );
    const asked = await askRoute(
      jsonRequest(`/api/materials/${materialId}/ask`, {
        method: "POST",
        cookie,
        body: { question: "vector search 是怎么工作的？" },
      }),
      params(materialId),
    );
    expect(asked.status).toBe(200);
    const body = (await asked.json()) as {
      answer: {
        mode: string;
        citations: { marker: number; text: string; page: number | null }[];
        issues: { kind: string }[];
      };
    };
    expect(body.answer.mode).toBe("llm");
    expect(body.answer.citations).toHaveLength(1);
    // 出处逐字来自材料，并且能定位到第 1 页
    expect(extraction.extraction.text).toContain(body.answer.citations[0].text);
    expect(body.answer.citations[0].page).toBe(1);
    expect(body.answer.issues.map((issue) => issue.kind)).not.toContain("unknown_citation");

    // 4) 别人的材料提问会被拒绝
    const intruder = await login("ask-intruder@example.com", "HTTP-CODE");
    const denied = await askRoute(
      jsonRequest(`/api/materials/${materialId}/ask`, {
        method: "POST",
        cookie: intruder.cookie,
        body: { question: "这是什么材料？" },
      }),
      params(materialId),
    );
    expect(denied.status).toBe(403);
  });

  it("导出三种格式 + 纠错上报 + 删除账号", async () => {
    const { cookie } = await login("exporter-http@example.com", "HTTP-CODE");

    const created = await createMaterialRoute(
      jsonRequest("/api/materials", {
        method: "POST",
        cookie,
        body: { title: "导出材料", rawText: SAMPLE_MATERIAL },
      }),
    );
    const materialId = ((await created.json()) as { material: { id: string } }).material.id;
    await outlineRoute(
      jsonRequest(`/api/materials/${materialId}/outline`, { method: "POST", cookie, body: {} }),
      params(materialId),
    );
    const examResponse = await createExamRoute(
      jsonRequest("/api/exams", {
        method: "POST",
        cookie,
        body: { materialId, topicIds: [], count: 4, mix: { mcq: 2, true_false: 1, cloze: 1 } },
      }),
    );
    const examId = ((await examResponse.json()) as { examId: string }).examId;
    const questionIds = await getStore().listExamQuestionIds(examId);
    const questions = await getStore().getQuestions(questionIds);
    const answers = questions.map((question) => ({
      questionId: question.id,
      payload:
        question.type === "mcq"
          ? { type: "mcq", index: 0 }
          : question.type === "true_false"
            ? { type: "true_false", value: true }
            : { type: "cloze", text: "光反应" },
    }));
    const submitted = await submitRoute(
      jsonRequest(`/api/exams/${examId}/submit`, { method: "POST", cookie, body: { answers } }),
      params(examId),
    );
    const attemptId = ((await submitted.json()) as { attemptId: string }).attemptId;

    // 导出：markdown / anki / backup 三种都必须能下载
    const markdown = await exportMarkdownRoute(jsonRequest("/api/export/markdown", { cookie }));
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-disposition")).toContain("attachment");
    expect(await markdown.text()).toContain("导出材料");

    const anki = await exportAnkiRoute(jsonRequest("/api/export/anki", { cookie }));
    expect(anki.status).toBe(200);
    expect(await anki.text()).toContain("jev-exam");

    const backup = await exportBackupRoute(jsonRequest("/api/export/backup", { cookie }));
    expect(backup.status).toBe(200);
    const bundle = JSON.parse(await backup.text()) as {
      format: string;
      materials: unknown[];
      attempts: unknown[];
    };
    expect(bundle.format).toBe("jev-exam-backup");
    expect(bundle.materials).toHaveLength(1);
    expect(bundle.attempts).toHaveLength(1);

    // 纠错上报
    const reported = await feedbackPostRoute(
      jsonRequest("/api/feedback", {
        method: "POST",
        cookie,
        body: { questionId: questions[0].id, attemptId, kind: "wrong_score", note: "判错了" },
      }),
    );
    expect(reported.status).toBe(201);
    const list = await feedbackRoute(jsonRequest("/api/feedback", { cookie }));
    expect(((await list.json()) as { reports: unknown[] }).reports).toHaveLength(1);

    // 确认邮箱不匹配时不能删号
    const wrongConfirm = await deleteAccountRoute(
      jsonRequest("/api/account", {
        method: "DELETE",
        cookie,
        body: { confirmEmail: "not-me@example.com" },
      }),
    );
    expect(wrongConfirm.status).toBe(400);

    // 删除账号：会话 Cookie 被清掉，数据也没了
    const deleted = await deleteAccountRoute(
      jsonRequest("/api/account", {
        method: "DELETE",
        cookie,
        body: { confirmEmail: "exporter-http@example.com" },
      }),
    );
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get("set-cookie")).toContain("jev_session=;");

    const afterDelete = await materialsRoute(jsonRequest("/api/materials", { cookie }));
    expect(afterDelete.status).toBe(401);
  });
});
