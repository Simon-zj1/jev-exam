import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { checkQuota } from "@/lib/quota";
import { listMasteryForUser } from "@/lib/services/mistakes";
import { listExamSummaries } from "@/lib/services/results";
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
            <span className="pill">Jev / System One · 决策模型驱动的自助考试</span>
            <h1>上传你的学习材料，自动出一套题，逐点判分</h1>
            <p>
              学习内容由你自己定。系统把材料切成知识点、生成题目与评分点，用决策模型
              （TypeSafe Jev）对每个得分点做类型化概率判定，再由代码合成分数——
              量化的是“你有没有说到这个点”，而不是“模型觉得你答得像不像”。
            </p>
            <div className="row">
              <Link className="pill" href="/login">
                邀请码登录 →
              </Link>
              <span className="small muted">
                默认引擎：{status.judgeLabel} / {status.generatorLabel}
              </span>
            </div>
          </section>

          <section className="grid grid--3">
            <div className="card">
              <h3>1. 出题与拆点（普通 LLM）</h3>
              <p className="small muted">
                Jev 不生成任何文字，所以材料理解、出题、评分点拆解由生成式模型完成，
                并且每道题都要能在原文中定位到出处。
              </p>
            </div>
            <div className="card">
              <h3>2. 客观题判分（确定性代码）</h3>
              <p className="small muted">
                单选、判断、填空先走规范化比对；只有填空需要判断“语义等价”时才会调用一次
                noul 问题。
              </p>
            </div>
            <div className="card">
              <h3>3. 主观题判分（每个得分点一条 noul）</h3>
              <p className="small muted">
                简答题不会用一个 0–100 的黑盒分数，而是逐点判定后按权重合成，
                并额外检查“是否与材料矛盾”“是否编造材料外的事实”。
              </p>
            </div>
          </section>

          <section className="card">
            <h2>为什么用决策模型而不是让 LLM 直接打分</h2>
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

        <section className="card">
          <div className="grid grid--3">
            <div>
              <div className="small muted">材料</div>
              <div className="score">{materials.length}</div>
            </div>
            <div>
              <div className="small muted">今日剩余题目额度</div>
              <div className="score">
                {Math.max(0, quota.limits.question - quota.usage.question)}
                <span className="small muted"> / {quota.limits.question}</span>
              </div>
            </div>
            <div>
              <div className="small muted">今日剩余判定额度</div>
              <div className="score">
                {Math.max(0, quota.limits.judgment - quota.usage.judgment)}
                <span className="small muted"> / {quota.limits.judgment}</span>
              </div>
            </div>
          </div>
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
