"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROVIDER_CATALOG, providerOptions, type ProviderKind } from "@/lib/llm/catalog";

type Summary = {
  judgeConfigured: boolean;
  llmConfigured: boolean;
  judgeModel: string | null;
  llmModel: string | null;
  llmProvider: string | null;
  judgeBaseUrl: string | null;
  llmBaseUrl: string | null;
};

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; detail: string }
  | { status: "error"; message: string };

/**
 * 面向不懂技术的用户：选服务商 → 粘 Key → 测试 → 保存。
 * 接口地址与模型名都给好默认值，放在"高级设置"里，不用用户自己查文档。
 */
export function ByokForm({ initial }: { initial: Summary }) {
  const router = useRouter();
  const options = providerOptions();

  const [provider, setProvider] = useState<ProviderKind>(
    (initial.llmProvider as ProviderKind | null) ?? "deepseek",
  );
  const [llmKey, setLlmKey] = useState("");
  const [model, setModel] = useState(initial.llmModel ?? "");
  const [baseUrl, setBaseUrl] = useState(initial.llmBaseUrl ?? "");
  const [judgeKey, setJudgeKey] = useState("");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const profile = PROVIDER_CATALOG[provider];
  const effectiveModel = model.trim() || profile.defaultModel;
  const effectiveBaseUrl = baseUrl.trim() || profile.baseUrl;

  async function runTest(): Promise<void> {
    setTest({ status: "testing" });
    try {
      const response = await fetch("/api/provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: llmKey.trim(),
          baseUrl: baseUrl.trim() || undefined,
          model: model.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        actualModel?: string;
        latencyMs?: number;
        sample?: string;
      };
      if (!response.ok || !payload.ok) {
        setTest({ status: "error", message: payload.error ?? "连接失败" });
        return;
      }
      setTest({
        status: "ok",
        detail: `已连通 ${payload.actualModel ?? effectiveModel} · ${payload.latencyMs ?? "?"}ms${
          payload.sample ? ` · 返回「${payload.sample}」` : ""
        }`,
      });
    } catch (err) {
      setTest({ status: "error", message: (err as Error).message });
    }
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage(null);
        setError(null);
        try {
          const body: Record<string, unknown> = {};
          if (llmKey.trim()) {
            body.llm = {
              apiKey: llmKey.trim(),
              provider,
              model: model.trim() || undefined,
              baseUrl: baseUrl.trim() || undefined,
            };
          }
          if (judgeKey.trim()) {
            body.judge = { apiKey: judgeKey.trim() };
          }
          if (Object.keys(body).length === 0) {
            setError("请先填入 API Key；不想配置也可以继续使用平台演示模式。");
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
          setLlmKey("");
          setJudgeKey("");
          setMessage("已保存。密钥加密存储，只在你自己的请求中使用，不占平台额度。");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <h3>1. 选择模型服务商</h3>
      <p className="small muted">
        国内可直接访问的服务商排在前面。没有 Key 的话，点下面的链接去申请，一般几分钟就能拿到。
      </p>
      <div className="field">
        <label htmlFor="provider">服务商</label>
        <select
          id="provider"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as ProviderKind);
            setModel("");
            setBaseUrl("");
            setTest({ status: "idle" });
          }}
        >
          {options.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
        {profile.keysUrl ? (
          <p className="small muted" style={{ marginTop: 6 }}>
            还没有 Key？
            <a href={profile.keysUrl} target="_blank" rel="noopener noreferrer">
              去 {profile.label} 申请 →
            </a>
          </p>
        ) : null}
      </div>

      <h3>2. 粘贴 API Key</h3>
      <div className="field">
        <label htmlFor="llmKey">API Key{profile.local ? "（本地模型可留空）" : ""}</label>
        <input
          id="llmKey"
          type="password"
          value={llmKey}
          onChange={(event) => {
            setLlmKey(event.target.value);
            setTest({ status: "idle" });
          }}
          placeholder={initial.llmConfigured ? "已配置；留空表示不修改" : "粘贴即可，页面上不会回显"}
          autoComplete="off"
        />
      </div>

      <h3>3. 模型</h3>
      <div className="field">
        <label htmlFor="model">模型名（留空用推荐值）</label>
        <input
          id="model"
          type="text"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={profile.defaultModel}
          list="model-suggestions"
        />
        <datalist id="model-suggestions">
          {profile.models.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <p className="small muted" style={{ marginTop: 6 }}>
          将使用：{effectiveModel || "—"}
          {effectiveBaseUrl ? ` · 接口地址 ${effectiveBaseUrl}` : ""}
        </p>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" onClick={runTest} disabled={test.status === "testing"}>
          {test.status === "testing" ? "测试中…" : "测试连接"}
        </button>
        {test.status === "ok" ? <span className="pill pill--ok">{test.detail}</span> : null}
        {test.status === "error" ? <span className="pill pill--err">{test.message}</span> : null}
      </div>

      <details>
        <summary className="small muted">高级设置（接口地址、判分引擎）</summary>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="baseUrl">接口地址（Base URL，留空用官方地址）</label>
          <input
            id="baseUrl"
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={profile.baseUrl || "https://example.com/v1"}
          />
        </div>
        <div className="field">
          <label htmlFor="judgeKey">判分引擎 Key（可选：TypeSafe Jev）</label>
          <input
            id="judgeKey"
            type="password"
            value={judgeKey}
            onChange={(event) => setJudgeKey(event.target.value)}
            placeholder={initial.judgeConfigured ? "已配置；留空表示不修改" : "不填则用通用模型判分"}
            autoComplete="off"
          />
          <p className="small muted" style={{ marginTop: 6 }}>
            填入后，主观题改用校准过的决策模型判定（更稳、更便宜）；不填也能用，只是判定质量略低。
          </p>
        </div>
      </details>

      {message ? <div className="banner banner--info">{message}</div> : null}
      {error ? <div className="banner banner--err">{error}</div> : null}

      <div className="row row--between">
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存并启用"}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={async () => {
            await fetch("/api/byok", { method: "DELETE" });
            setMessage("已清除自定义密钥，将回落到平台配置或演示模式。");
            router.refresh();
          }}
        >
          清除我的密钥
        </button>
      </div>
    </form>
  );
}
