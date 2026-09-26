import Link from "next/link";
import { redirect } from "next/navigation";
import { ByokForm } from "@/components/byok-form";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { QuotaCard } from "@/components/quota-card";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { formatMicroUsd } from "@/lib/llm/usage";
import { checkQuota } from "@/lib/quota";
import { readByok, summarizeByok } from "@/lib/services/byok";
import { engineStatus } from "@/lib/services/status";
import { todayLlmUsage } from "@/lib/services/usage";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const status = engineStatus();
  const quota = await checkQuota(user.id, {});
  const byok = summarizeByok(readByok(user));
  const usage = await todayLlmUsage(user.id);

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>设置</h1>

        <section className="card">
          <h2>今日额度</h2>
          <QuotaCard usage={quota.usage} byokActive={byok.judgeConfigured || byok.llmConfigured} />
        </section>

        <section className="card">
          <h2>当前引擎</h2>
          <table>
            <tbody>
              <tr>
                <td>判定引擎</td>
                <td>
                  {status.judgeLabel}（{status.judgeMode}）
                </td>
              </tr>
              <tr>
                <td>出题模型</td>
                <td>
                  {status.generatorLabel}（{status.generatorMode}）
                </td>
              </tr>
              {status.generatorModel ? (
                <tr>
                  <td>模型与来源</td>
                  <td>
                    {status.generatorModel}
                    {status.generatorProvider ? ` · ${status.generatorProvider}` : ""} ·{" "}
                    {status.generatorSource}
                    {status.generatorDetectedFromKey ? "（由 key 形状推断）" : ""}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {status.demoMode ? (
            <div className="banner banner--warn" style={{ marginTop: 12, marginBottom: 0 }}>
              当前是离线演示模式：判定使用词面近似而非 Jev，不能代表真实判定质量。
              配置平台密钥或填写自己的密钥后会立刻切换。
            </div>
          ) : null}
        </section>

        <section className="card">
          <h2>今日模型成本（估算）</h2>
          {usage.byModel.length === 0 ? (
            <p className="small muted">今天还没有调用模型。</p>
          ) : (
            <>
              <p className="small muted">
                共 {usage.total.calls} 次调用，输入 {usage.total.inputTokens} tokens、输出{" "}
                {usage.total.outputTokens} tokens，估算 {formatMicroUsd(usage.total.costMicroUsd)}。
                价格按公开价折算，用于看趋势，不等于账单。
              </p>
              <table>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>调用</th>
                    <th>输入 tokens</th>
                    <th>输出 tokens</th>
                    <th>估算费用</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byModel.map((record) => (
                    <tr key={record.model}>
                      <td className="small">{record.model}</td>
                      <td className="small">{record.calls}</td>
                      <td className="small">{record.inputTokens}</td>
                      <td className="small">{record.outputTokens}</td>
                      <td className="small">{formatMicroUsd(record.costMicroUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="card">
          <h2>自带密钥（BYOK）</h2>
          <p className="small muted">
            密钥使用 AES-256-GCM 加密后存储，仅在你自己的请求中使用，不会回显、不会下发给浏览器。
            留空表示保持原值。
          </p>
          <ByokForm initial={byok} />
        </section>

        <section className="card">
          <h2>数据与隐私</h2>
          <ul className="small muted">
            <li>材料只对你可见；跨用户读取会被拒绝。</li>
            <li>删除材料时，其派生的大纲、试卷、作答与判定记录会一并删除。</li>
            <li>上传内容不会用于训练模型。</li>
            <li>
              使用条款见 <Link href="/terms">服务条款</Link>，数据处理见{" "}
              <Link href="/privacy">隐私说明</Link>。
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>导出我的数据</h2>
          <p className="small muted">
            你的材料、错题与掌握度属于你。这三种格式都可以脱离本站使用：
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <a className="pill" href="/api/export/markdown">
              导出 Markdown（材料 + 题目 + 学习状态）
            </a>
            <a className="pill" href="/api/export/anki">
              导出 Anki CSV（复习卡片）
            </a>
            <a className="pill" href="/api/export/backup">
              导出完整备份 JSON
            </a>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            完整备份包含材料原文、题目与评分点、作答与判定、掌握度、复习排期与纠错记录，
            用于迁移或自留底。导出内容不经过压缩，也不含你的 API Key。
          </p>
        </section>

        <section className="card">
          <h2>删除账号</h2>
          <p className="small muted">
            删除后无法恢复。若只是想清空内容，可以直接在材料列表里逐份删除。
          </p>
          <DeleteAccountForm email={user.email} />
        </section>
      </main>
    </>
  );
}
