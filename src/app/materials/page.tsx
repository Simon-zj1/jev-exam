import Link from "next/link";
import { MaterialForm } from "@/components/material-form";
import { TopBar } from "@/components/top-bar";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { engineStatus } from "@/lib/services/status";
import { listMaterialsForUser } from "@/lib/services/materials";
import { listExamSummaries } from "@/lib/services/results";

export const dynamic = "force-dynamic";

export default async function MaterialsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [materials, exams] = await Promise.all([
    listMaterialsForUser(user),
    listExamSummaries(user),
  ]);
  const status = engineStatus();

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        {status.demoMode ? (
          <div className="banner banner--warn">
            当前处于<b>离线演示模式</b>：出题使用离线启发式（{status.generatorLabel}），判定使用
            {status.judgeLabel}。它只用于把闭环跑通，不代表真实判定质量。配置
            <span className="kbd">TYPESAFE_API_KEY</span> 与
            <span className="kbd">PLATFORM_LLM_API_KEY</span>，或在设置里填自己的密钥，即可切换到
            Jev 判定。
          </div>
        ) : null}

        <div className="grid grid--2">
          <section className="card">
            <h2>新建材料</h2>
            <MaterialForm />
          </section>

          <section className="card">
            <h2>已有材料</h2>
            {materials.length === 0 ? (
              <div className="empty">还没有材料。左侧粘贴一段要考的内容即可开始。</div>
            ) : (
              <div className="stack">
                {materials.map((material) => (
                  <div key={material.id} className="row row--between">
                    <div>
                      <Link href={`/materials/${material.id}`}>{material.title}</Link>
                      <div className="small muted">
                        {material.rawText.length} 字符 · 约 {material.tokenCount} tokens ·{" "}
                        {new Date(material.createdAt).toLocaleString("zh-CN")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="card">
          <h2>试卷与成绩</h2>
          {exams.length === 0 ? (
            <div className="empty">还没有试卷。进入某个材料，确认知识点后即可生成。</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>试卷</th>
                  <th>材料</th>
                  <th>题量</th>
                  <th>最近成绩</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exams.map((summary) => (
                  <tr key={summary.exam.id}>
                    <td>
                      {summary.exam.title}
                      <div className="small muted">
                        {summary.exam.kind === "mistake_retry" ? "错题重考" : "常规生成"} ·{" "}
                        {new Date(summary.exam.createdAt).toLocaleDateString("zh-CN")}
                      </div>
                    </td>
                    <td className="small">{summary.material?.title ?? "—"}</td>
                    <td className="small">{summary.exam.config.count}</td>
                    <td className="small">
                      {summary.latestAttempt
                        ? `${summary.latestAttempt.scorePercent ?? 0} 分${
                            (summary.latestAttempt.needsReviewCount ?? 0) > 0
                              ? `（${summary.latestAttempt.needsReviewCount} 题待复核）`
                              : ""
                          }`
                        : "未作答"}
                    </td>
                    <td className="small">
                      <Link
                        href={
                          summary.latestAttempt
                            ? `/attempts/${summary.latestAttempt.id}`
                            : `/exams/${summary.exam.id}/take`
                        }
                      >
                        {summary.latestAttempt ? "查看结果" : "开始作答"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
