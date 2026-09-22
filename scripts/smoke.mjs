/**
 * 真实服务器冒烟测试：对已启动的 Next 服务跑完整闭环。
 *
 *   INITIAL_INVITE_CODES=SMOKE-CODE npm run build && npm run start -- -p 3111
 *   BASE_URL=http://localhost:3111 INVITE_CODE=SMOKE-CODE npm run smoke
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const INVITE_CODE = process.env.INVITE_CODE ?? "DEV-INVITE";
const EMAIL = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@example.com`;

const MATERIAL = [
  "光合作用分为光反应和暗反应两个阶段。",
  "光反应发生在类囊体薄膜上，需要光照，水在光下分解产生氧气和还原型辅酶Ⅱ。",
  "光反应把光能转变成活跃的化学能并储存在ATP中。",
  "暗反应发生在叶绿体基质中，不需要光照。",
  "暗反应中二氧化碳被固定后，利用光反应产生的ATP和还原型辅酶Ⅱ还原成糖类。",
  "影响光合作用速率的外界因素包括光照强度、二氧化碳浓度和温度。",
].join("\n");

let cookie = "";
const results = [];

function record(label, status, extra = "") {
  const ok = status >= 200 && status < 400;
  results.push({ label, status, ok });
  console.log(`${ok ? "✓" : "✗"} ${label} → ${status} ${extra}`);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "follow",
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/jev_session=[^;]+/);
    if (match) cookie = match[0];
  }
  return response;
}

async function main() {
  const landing = await request("/");
  const landingHtml = await landing.text();
  record("落地页", landing.status, landingHtml.includes("决策模型") ? "含产品说明" : "");

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: EMAIL, inviteCode: INVITE_CODE },
  });
  record("邀请码登录", login.status);

  const material = await request("/api/materials", {
    method: "POST",
    body: { title: "冒烟测试材料", rawText: MATERIAL },
  });
  const materialId = (await material.json()).material?.id;
  record("上传材料", material.status, materialId ?? "");
  if (!materialId) throw new Error("缺少 materialId");

  const outline = await request(`/api/materials/${materialId}/outline`, { method: "POST", body: {} });
  const topics = (await outline.json()).topics ?? [];
  record("生成大纲", outline.status, `${topics.length} 个知识点`);

  const exam = await request("/api/exams", {
    method: "POST",
    body: {
      materialId,
      topicIds: topics.map((topic) => topic.id),
      count: 8,
      mix: { mcq: 3, true_false: 2, cloze: 1, short_answer: 2 },
    },
  });
  const examId = (await exam.json()).examId;
  record("生成试卷", exam.status, examId ?? "");
  if (!examId) throw new Error("缺少 examId");

  const takePage = await request(`/exams/${examId}/take`);
  const takeHtml = await takePage.text();
  record(
    "作答页（服务端渲染）",
    takePage.status,
    takeHtml.includes("提交并查看判定结果") ? "含作答表单" : "",
  );

  const takeView = await request(`/api/exams/${examId}`);
  const takeBody = await takeView.text();
  const leaked = ["answerKey", "rubricPoints", "reference_answer", "correct_index"].filter((key) =>
    takeBody.includes(key),
  );
  record("作答接口不泄露答案", leaked.length === 0 ? 200 : 500, leaked.join(","));
  const questions = JSON.parse(takeBody).questions ?? [];

  const answers = questions.map((question) =>
    question.type === "mcq"
      ? { questionId: question.id, payload: { type: "mcq", index: 0 } }
      : question.type === "true_false"
        ? { questionId: question.id, payload: { type: "true_false", value: true } }
        : question.type === "cloze"
          ? { questionId: question.id, payload: { type: "cloze", text: "光反应" } }
          : {
              questionId: question.id,
              payload: {
                type: "short_answer",
                text: "光反应发生在类囊体薄膜上，需要光照，并把光能储存在ATP中。",
              },
            },
  );

  const submit = await request(`/api/exams/${examId}/submit`, {
    method: "POST",
    body: { answers },
  });
  const submission = await submit.json();
  record(
    "提交判定",
    submit.status,
    typeof submission.scorePercent === "number"
      ? `${submission.scorePercent} 分 / ${submission.judgedCount} 题 / 引擎 ${submission.engineId}`
      : "",
  );

  const attemptId = submission.attemptId;
  const resultPage = await request(`/attempts/${attemptId}`);
  const resultHtml = await resultPage.text();
  record(
    "判定报告页",
    resultPage.status,
    resultHtml.includes("判定报告") ? "渲染正常" : "",
  );

  const mistakes = await request("/mistakes");
  record("错题本页", mistakes.status, (await mistakes.text()).includes("错题本") ? "渲染正常" : "");

  const settings = await request("/settings");
  record("设置页", settings.status, (await settings.text()).includes("自带密钥") ? "渲染正常" : "");

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n冒烟结果：${results.length - failed.length}/${results.length} 通过${
      failed.length > 0 ? `，失败：${failed.map((item) => item.label).join("、")}` : ""
    }`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\n冒烟测试失败：", error);
  process.exit(1);
});
