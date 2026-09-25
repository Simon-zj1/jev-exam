"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Summary = {
  judgeConfigured: boolean;
  llmConfigured: boolean;
  judgeModel: string | null;
  llmModel: string | null;
  judgeBaseUrl: string | null;
  llmBaseUrl: string | null;
};

export function ByokForm({ initial }: { initial: Summary }) {
  const router = useRouter();
  const [judgeKey, setJudgeKey] = useState("");
  const [judgeModel, setJudgeModel] = useState(initial.judgeModel ?? "");
  const [judgeBaseUrl, setJudgeBaseUrl] = useState(initial.judgeBaseUrl ?? "");
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState(initial.llmModel ?? "");
  const [llmBaseUrl, setLlmBaseUrl] = useState(initial.llmBaseUrl ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage(null);
        setError(null);
        try {
          const body: Record<string, unknown> = {};
          if (judgeKey.trim()) {
            body.judge = {
              apiKey: judgeKey.trim(),
              model: judgeModel.trim() || undefined,
              baseUrl: judgeBaseUrl.trim() || undefined,
            };
          }
          if (llmKey.trim()) {
            body.llm = {
              apiKey: llmKey.trim(),
              model: llmModel.trim() || undefined,
              baseUrl: llmBaseUrl.trim() || undefined,
            };
          }
          if (Object.keys(body).length === 0) {
            setError("请至少填写一个密钥");
            return;
          }
          const response = await fetch("/api/byok", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) {
            setError(payload.error ?? "保存失败");
            return;
          }
          setJudgeKey("");
          setLlmKey("");
          setMessage("已保存。密钥加密存储，仅在你自己的请求中使用，不占平台额度。");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid grid--2">
        <div>
          <h3>判定密钥（TypeSafe / Jev）</h3>
          <p className="small muted">
            当前状态：{initial.judgeConfigured ? "已配置" : "未配置"}
          </p>
          <div className="field">
            <label htmlFor="judgeKey">API Key</label>
            <input
              id="judgeKey"
              type="password"
              value={judgeKey}
              onChange={(event) => setJudgeKey(event.target.value)}
              placeholder="留空表示不修改"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="judgeModel">模型（可选，默认 jev-latest）</label>
            <input
              id="judgeModel"
              type="text"
              value={judgeModel}
              onChange={(event) => setJudgeModel(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="judgeBaseUrl">Base URL（可选）</label>
            <input
              id="judgeBaseUrl"
              type="text"
              value={judgeBaseUrl}
              onChange={(event) => setJudgeBaseUrl(event.target.value)}
              placeholder="https://api.typesafe.ai"
            />
          </div>
        </div>

        <div>
          <h3>出题密钥（兼容 OpenAI 接口）</h3>
          <p className="small muted">
            当前状态：{initial.llmConfigured ? "已配置" : "未配置"}
          </p>
          <div className="field">
            <label htmlFor="llmKey">API Key</label>
            <input
              id="llmKey"
              type="password"
              value={llmKey}
              onChange={(event) => setLlmKey(event.target.value)}
              placeholder="留空表示不修改"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="llmModel">模型</label>
            <input
              id="llmModel"
              type="text"
              value={llmModel}
              onChange={(event) => setLlmModel(event.target.value)}
              placeholder="例如 gpt-5-mini / deepseek-chat"
            />
          </div>
          <div className="field">
            <label htmlFor="llmBaseUrl">Base URL</label>
            <input
              id="llmBaseUrl"
              type="text"
              value={llmBaseUrl}
              onChange={(event) => setLlmBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
        </div>
      </div>

      {message ? <div className="banner banner--info">{message}</div> : null}
      {error ? <div className="banner banner--err">{error}</div> : null}

      <div className="row row--between">
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存密钥"}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={async () => {
            await fetch("/api/byok", { method: "DELETE" });
            setMessage("已清除自定义密钥，将回落到平台密钥或离线演示模式。");
            router.refresh();
          }}
        >
          清除自定义密钥
        </button>
      </div>
    </form>
  );
}
