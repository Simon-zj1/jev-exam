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
            <p className="hero__eyebrow">用自己的资料，考自己</p>
            <h1>把资料变成考卷，做完告诉你哪里没学会</h1>
            <p className="lede">
              上传教材、笔记或讲义（PDF / Word / 纯文本都行），自动出题；答完按得分点逐条批改，
              明确指出你漏掉了哪一个要点。看不懂可以就材料追问，回答逐句标注出处；
              错题按间隔重复排期，告诉你什么时候该再看一遍。
            </p>
            <div className="hero__actions">
              <Link className="btn btn--primary" href="/login">
                用邀请码登录
              </Link>
              <a className="btn btn--quiet" href="/demo/jev-exam-report.html">
                先看一份示例报告
              </a>
            </div>
            {status.demoMode ? (
              <p className="small muted" style={{ marginTop: "var(--s4)", marginBottom: 0 }}>
                当前实例未配置模型，使用内置演示模式；登录后可在设置里换成自己的模型 Key。
              </p>
            ) : null}
          </section>

          <section className="section">
            <div className="principles">
              <div className="principle">
                <span className="principle__index">01</span>
                <h3>读懂你的资料</h3>
                <p>先把内容拆成知识点再出题，每道题都能回到原文的某一句话，你可以随时核对它有没有乱编。</p>
              </div>
              <div className="principle">
                <span className="principle__index">02</span>
                <h3>两种题分别批改</h3>
                <p>选择、判断对错分明，直接判；简答按「得分点」逐条看你说到了没有，而不是笼统给一个分数。</p>
              </div>
              <div className="principle">
                <span className="principle__index">03</span>
                <h3>不确定会直说</h3>
                <p>模型没把握的题会标成「待复核」并给出分数范围，同时不计入掌握度，不用假确定的分数误导复习。</p>
              </div>
            </div>
          </section>

          <section className="section">
            <h2>为什么不用 ChatGPT 或 NotebookLM？</h2>
            <p className="section__hint">
              它们很擅长「读」和「讲」，但你要的是「练」和「知道自己哪里不会」。四件具体的事：
            </p>
            <div className="compare">
              <div className="compare__row">
                <div className="compare__side">
                  <h3>通用助手</h3>
                  <p>给一个听起来合理的分数，你无法核对；写完就结束，不记得你上周错在哪。</p>
                </div>
                <div className="compare__side compare__side--ours">
                  <h3>这里：逐点判定 + 复习闭环</h3>
                  <p>
                    简答题拆成得分点逐条判定，每条都能回到原文；判不准就标「待复核」。
                    错题自动进入 FSRS 排期，每天只让你看该看的那几张卡。
                  </p>
                </div>
              </div>
              <div className="compare__row">
                <div className="compare__side">
                  <h3>资料与答案分离</h3>
                  <p>先转成纯文本、再手动对照，出处要自己找。</p>
                </div>
                <div className="compare__side compare__side--ours">
                  <h3>这里：上传即用，答案带出处</h3>
                  <p>
                    直接上传 PDF / Word；追问的回答逐句带引注，PDF 还能点到「第几页」，
                    材料里没有的会直接说没有。
                  </p>
                </div>
              </div>
              <div className="compare__row">
                <div className="compare__side">
                  <h3>数据留在别人那里</h3>
                  <p>内容进得去、出不来，想换工具只能重来。</p>
                </div>
                <div className="compare__side compare__side--ours">
                  <h3>这里：数据在你手里</h3>
                  <p>
                    材料、错题、掌握度随时导出 Markdown、Anki CSV 或完整备份，账号一键删除。
                    想走随时走。
                  </p>
                </div>
              </div>
            </div>
            <p className="section__hint" style={{ marginTop: "var(--s5)", marginBottom: 0 }}>
              反过来，如果你要的是写作、头脑风暴或者开放式讨论，通用助手更合适——
              这里的强项只有一件：把你自己的材料变成一场可核对、会排期的考试。
            </p>
          </section>

          <section className="section">
            <details className="section__disclosure">
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

          <p className="small muted" style={{ paddingTop: "var(--s5)" }}>
            使用本站即表示同意 <Link href="/terms">服务条款</Link> 与{" "}
            <Link href="/privacy">隐私说明</Link>。
          </p>
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
      <main className="shell" style={{ paddingTop: "var(--s6)" }}>
        <header className="page-head">
          <div>
            <h1>开始一次自助考试</h1>
            <p className="small muted" style={{ margin: 0 }}>
              判定引擎：{status.judgeLabel} · 出题：{status.generatorLabel}
              {status.generatorModel ? `（${status.generatorModel}）` : ""}
              {status.demoMode ? " · 离线演示模式，质量不代表真实 Jev" : ""}
            </p>
          </div>
          <div className="row">
            <Link className="btn btn--primary" href="/materials">
              上传新材料
            </Link>
            {reviews.due > 0 ? (
              <Link className="btn" href="/reviews">
                复习 {reviews.due} 张
              </Link>
            ) : null}
          </div>
        </header>

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
              <Link className="btn" href="/settings">
                去配置模型
              </Link>
            </div>
          </div>
        ) : null}

        <div className="statband">
          <div>
            <div className="statband__label">今日待复习</div>
            <div className="statband__value">{reviews.due}</div>
          </div>
          <div>
            <div className="statband__label">复习队列</div>
            <div className="statband__value">{reviews.total}</div>
          </div>
          <div>
            <div className="statband__label">待复核</div>
            <div className="statband__value">
              {exams.reduce((sum, item) => sum + (item.latestAttempt?.needsReviewCount ?? 0), 0)}
            </div>
          </div>
          <div>
            <div className="statband__label">材料</div>
            <div className="statband__value">{materials.length}</div>
          </div>
          <div>
            <div className="statband__label">今日额度剩余</div>
            <div className="statband__value">
              {Math.max(0, quota.limits.question - quota.usage.question)}
            </div>
          </div>
        </div>

        <section className="section" style={{ paddingTop: "var(--s5)" }}>
          <QuotaCard usage={quota.usage} byokActive={Boolean(readByok(user))} />
        </section>

        <div className="grid grid--2" style={{ marginTop: "var(--s6)" }}>
          <section>
            <h2>最近的试卷</h2>
            {recent.length === 0 ? (
              <div className="empty">还没有试卷，先上传材料。</div>
            ) : (
              <div className="list">
                {recent.map((summary) => (
                  <div key={summary.exam.id} className="list__row">
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

          <section>
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
