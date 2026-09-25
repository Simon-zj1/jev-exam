import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { QuotaCard } from "@/components/quota-card";
import { getCurrentUser } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { checkQuota } from "@/lib/quota";
import { readByok } from "@/lib/services/byok";
import { listMasteryForUser } from "@/lib/services/mistakes";
import { listExamSummaries } from "@/lib/services/results";
import { reviewStats } from "@/lib/services/reviews";
import { engineStatus } from "@/lib/services/status";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const status = engineStatus();

  if (!user) {
    return (
      <>
        <TopBar user={null} />
        <main className="shell">
          <section className="hero">
            <span className="pill">上传资料就能考你</span>
            <h1>把资料变成考卷，做完告诉你哪里没学会</h1>
            <p>
              上传你自己的教材、笔记或讲义，系统自动出题；你答完，它按得分点逐条批改，
              明确指出你漏掉了哪一个要点。学习内容完全由你决定，资料只存在你自己的账号里。
            </p>
            <div className="row">
              <Link className="pill" href="/login">
                邀请码登录 →
              </Link>
              <span className="small muted">
                当前未配置模型，使用内置演示模式（可在设置里换成你自己的模型 Key）
              </span>
            </div>
          </section>

          <section className="grid grid--3">
            <div className="card">
              <h3>1. 读懂你的资料</h3>
              <p className="small muted">
                先把你上传的内容拆成知识点，再据此出题。每道题都能回到原文的某一句话，
                你随时可以核对它有没有乱编。
              </p>
            </div>
            <div className="card">
              <h3>2. 两种题分别批改</h3>
              <p className="small muted">
                选择题、判断题对错分明，直接判；简答题按「得分点」逐条看你说到了没有，
                而不是笼统给一个分数。
              </p>
            </div>
            <div className="card">
              <h3>3. 不确定会直接告诉你</h3>
              <p className="small muted">
                模型没把握的题目会标成「待复核」并给出分数范围，同时不计入你的掌握度，
                不会用假装确定的分数误导复习方向。
              </p>
            </div>
          </section>

          <section className="card">
            <details>
              <summary className="muted">技术细节：为什么不让大模型直接打个分？（给开发者）</summary>
              <p className="small muted" style={{ marginTop: 12 }}>
                一句话：直接打分得到的是一个无法核对的黑盒数字。这里改成把主观题拆成
                「每个得分点一条类型化问题」，由决策模型（TypeSafe Jev / System One）输出概率，
                再由代码按权重合成——所以分数能逐条核对，也有置信度可用于门控。
              </p>
              <table>
              <thead>
                <tr>
                  <th>维度</th>
                  <th>Jev（决策模型）</th>
                  <th>普通 LLM 打分</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>输出</td>
                  <td>类型化概率（noul / choice / score），代码可直接用</td>
                  <td>文本或 JSON，需要解析，可能跑偏</td>
                </tr>
                <tr>
                  <td>不确定性</td>
                  <td>自带校准概率与置信度，可做门控</td>
                  <td>容易过度自信，置信度不可靠</td>
                </tr>
                <tr>
                  <td>速度与成本</td>
                  <td>百毫秒级，输入 $0.042/百万 token，输出免费</td>
                  <td>秒级到分钟级，输出按 token 计费</td>
                </tr>
                <tr>
                  <td>可解释性</td>
                  <td>不给理由——所以解释必须来自 rubric 点本身</td>
                  <td>能给理由，但理由不一定可信</td>
                </tr>
              </tbody>
              </table>
            </details>
          </section>
        </main>
      </>
    );
  }

  const [quota, exams, mastery] = await Promise.all([
    checkQuota(user.id, {}),
    listExamSummaries(user),
    listMasteryForUser(user),
  ]);
  const reviews = await reviewStats(user);
  const materials = await getStore().listMaterials(user.id);
  const weak = mastery.slice(0, 5);
  const recent = exams.slice(0, 6);

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>开始一次自助考试</h1>
        <p className="muted small">
          判定引擎：{status.judgeLabel} · 出题：{status.generatorLabel}
          {status.demoMode ? "（离线演示模式，质量不代表真实 Jev）" : ""}
        </p>

        {status.demoMode ? (
          <div className="banner banner--warn">
            <div className="row row--between">
              <div>
                <strong>还差一步：配置你自己的模型</strong>
                <div className="small" style={{ marginTop: 4 }}>
                  现在用的是内置演示引擎，出题与判分都很粗糙。选一家国内可直连的服务商
                  （DeepSeek / 智谱 GLM / 通义千问 / Kimi），粘贴 Key 后点「测试连接」即可，
                  两分钟完成，密钥只存在你自己的账号下。
                </div>
              </div>
              <Link className="pill pill--warn" href="/settings">
                去配置模型 →
              </Link>
            </div>
          </div>
        ) : null}

        <div className="grid grid--2">
          <section className="card">
            <QuotaCard usage={quota.usage} byokActive={Boolean(readByok(user))} />
            <div className="divider" />
            <div className="row">
              <Link className="pill" href="/materials">
                上传新材料 →
              </Link>
              <Link className="pill" href="/mistakes">
                查看错题本 →
              </Link>
            </div>
          </section>
          <section className="card">
            <div className="row row--between">
              <strong>学习概况</strong>
              <span className="small muted">材料 {materials.length} 份</span>
            </div>
            <div className="grid grid--3" style={{ marginTop: 8 }}>
              <div>
                <div className="small muted">今日待复习</div>
                <div className="score">{reviews.due}</div>
              </div>
              <div>
                <div className="small muted">复习队列</div>
                <div className="score">{reviews.total}</div>
              </div>
              <div>
                <div className="small muted">待复核</div>
                <div className="score">
                  {exams.reduce((sum, item) => sum + (item.latestAttempt?.needsReviewCount ?? 0), 0)}
                </div>
              </div>
            </div>
            {reviews.due > 0 ? (
              <div className="row" style={{ marginTop: 12 }}>
                <Link className="pill pill--warn" href="/reviews">
                  开始复习 {reviews.due} 张卡片 →
                </Link>
              </div>
            ) : null}
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
              判定引擎：{status.judgeLabel}；出题：{status.generatorLabel}
              {status.generatorModel ? `（${status.generatorModel}）` : ""}
            </p>
          </section>
        </div>

        <div className="grid grid--2">
          <section className="card">
            <h2>最近的试卷</h2>
            {recent.length === 0 ? (
              <div className="empty">还没有试卷，先上传材料。</div>
            ) : (
              <div className="stack">
                {recent.map((summary) => (
                  <div key={summary.exam.id} className="row row--between">
                    <div>
                      <strong>{summary.exam.title}</strong>
                      <div className="small muted">
                        {summary.exam.config.count} 题 ·{" "}
                        {summary.latestAttempt
                          ? `${summary.latestAttempt.scorePercent ?? 0} 分`
                          : "未作答"}
                      </div>
                    </div>
                    <Link
                      href={
                        summary.latestAttempt
                          ? `/attempts/${summary.latestAttempt.id}`
                          : `/exams/${summary.exam.id}/take`
                      }
                    >
                      {summary.latestAttempt ? "查看结果" : "开始作答"}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h2>薄弱点</h2>
            {weak.length === 0 ? (
              <div className="empty">还没有掌握度数据。</div>
            ) : (
              <div className="stack">
                {weak.map((record) => (
                  <div key={record.topicKey}>
                    <div className="row row--between small">
                      <span>{record.topicTitle}</span>
                      <span className="muted">{Math.round(record.value * 100)}%</span>
                    </div>
                    <div className="meter">
                      <div
                        className={`meter__fill${record.value < 0.6 ? "" : " meter__fill--ok"}`}
                        style={{ width: `${Math.round(record.value * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
