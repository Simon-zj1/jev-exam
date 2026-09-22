import Link from "next/link";
import { redirect } from "next/navigation";
import { RetryMaterialMistakesButton } from "@/components/retry-material-mistakes-button";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { listMasteryForUser, listMistakeGroups } from "@/lib/services/mistakes";

export const dynamic = "force-dynamic";

export default async function MistakesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [groups, mastery] = await Promise.all([
    listMistakeGroups(user),
    listMasteryForUser(user),
  ]);
  const totalMistakes = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>错题本与薄弱点</h1>
        <p className="muted small">
          得分低于 60 分的题目会进入错题本；重考答对后自动移除。待复核的题目不计入掌握度，
          因此不会污染这里的薄弱点判断。
        </p>

        {totalMistakes === 0 && mastery.length === 0 ? (
          <div className="empty">
            还没有错题记录。先去做一套题吧：<Link href="/materials">去材料列表</Link>
          </div>
        ) : null}

        {groups.length > 0 ? (
          <section className="card">
            <h2>错题（{totalMistakes}）</h2>
            <div className="stack">
              {groups.map((group) => (
                <div key={group.materialId}>
                  <div className="row row--between">
                    <div>
                      <strong>
                        <Link href={`/materials/${group.materialId}`}>
                          {group.materialTitle}
                        </Link>
                      </strong>
                      <div className="small muted">{group.items.length} 道错题</div>
                    </div>
                    <RetryMaterialMistakesButton materialId={group.materialId} />
                  </div>
                  <table style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th>题目</th>
                        <th>知识点</th>
                        <th>最近得分</th>
                        <th>累计错次</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => (
                        <tr key={item.mistake.questionId}>
                          <td className="small">
                            {item.studentView?.stem.slice(0, 80) ?? "（题目已删除）"}
                          </td>
                          <td className="small">{item.mistake.topicTitle}</td>
                          <td className="small">{item.mistake.lastScorePercent}</td>
                          <td className="small">{item.mistake.wrongCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {mastery.length > 0 ? (
          <section className="card">
            <h2>知识点掌握度</h2>
            <p className="small muted">
              每次判定后按 0.3 的学习率做指数滑动平均；待复核的题目不参与更新。
            </p>
            <table>
              <thead>
                <tr>
                  <th>知识点</th>
                  <th>掌握度</th>
                  <th>样本数</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mastery.map((record) => (
                  <tr key={record.topicKey}>
                    <td className="small">{record.topicTitle}</td>
                    <td className="small" style={{ width: 180 }}>
                      <div className="meter">
                        <div
                          className={`meter__fill${
                            record.value >= 0.8
                              ? " meter__fill--ok"
                              : record.value >= 0.6
                                ? " meter__fill--warn"
                                : ""
                          }`}
                          style={{ width: `${Math.round(record.value * 100)}%` }}
                        />
                      </div>
                      <span className="small muted">{Math.round(record.value * 100)}%</span>
                    </td>
                    <td className="small">{record.sampleCount}</td>
                    <td className="small muted">
                      {record.value < 0.6 ? "薄弱点，优先复习" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </main>
    </>
  );
}
