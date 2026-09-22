import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as materialsRoute, POST as createMaterialRoute } from "@/app/api/materials/route";
import { GET as materialDetailRoute } from "@/app/api/materials/[id]/route";
import { POST as outlineRoute } from "@/app/api/materials/[id]/outline/route";
import { POST as createExamRoute } from "@/app/api/exams/route";
import { GET as examRoute } from "@/app/api/exams/[id]/route";
import { POST as submitRoute } from "@/app/api/exams/[id]/submit/route";
import { GET as attemptRoute } from "@/app/api/attempts/[id]/route";
import { GET as meRoute } from "@/app/api/me/route";
import { QUOTA_LIMITS } from "@/lib/config";
import { getStore } from "@/lib/db";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { FakeEngine, SAMPLE_MATERIAL, noul, resetOverrides, useMemoryStore } from "../helpers";

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

  it("未登录时所有业务接口返回 401", async () => {
    for (const response of [
      await materialsRoute(jsonRequest("/api/materials")),
      await createMaterialRoute(jsonRequest("/api/materials", { method: "POST", body: {} })),
      await meRoute(jsonRequest("/api/me")),
    ]) {
      expect(response.status).toBe(401);
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("unauthorized");
    }
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
});
