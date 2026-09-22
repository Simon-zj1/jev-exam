import { redirect } from "next/navigation";
import { ByokForm } from "@/components/byok-form";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { checkQuota } from "@/lib/quota";
import { readByok, summarizeByok } from "@/lib/services/byok";
import { engineStatus } from "@/lib/services/status";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const status = engineStatus();
  const quota = await checkQuota(user.id, {});
  const byok = summarizeByok(readByok(user));

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>设置</h1>

        <section className="card">
          <h2>今日额度</h2>
          <table>
            <thead>
              <tr>
                <th>项目</th>
                <th>已用</th>
                <th>上限</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>上传材料</td>
                <td>{quota.usage.material}</td>
                <td>{quota.limits.material}</td>
              </tr>
              <tr>
                <td>生成题目</td>
                <td>{quota.usage.question}</td>
                <td>{quota.limits.question}</td>
              </tr>
              <tr>
                <td>判定次数</td>
                <td>{quota.usage.judgment}</td>
                <td>{quota.limits.judgment}</td>
              </tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 10 }}>
            额度按 Asia/Shanghai 自然日重置。使用自带密钥（BYOK）的调用不占用平台额度。
          </p>
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
          </ul>
        </section>
      </main>
    </>
  );
}
