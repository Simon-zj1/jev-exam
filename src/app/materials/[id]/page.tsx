import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExamBuilder } from "@/components/exam-builder";
import { GenerateOutlineButton } from "@/components/generate-outline-button";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import {
  DEFAULT_QUESTION_COUNT,
  DEFAULT_QUESTION_MIX,
  MAX_QUESTION_COUNT,
  MIN_QUESTION_COUNT,
} from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { getBlueprintForMaterial } from "@/lib/services/generation";
import { getMaterialForUser } from "@/lib/services/materials";
import { listExamSummaries } from "@/lib/services/results";
import { truncate } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let material;
  try {
    material = await getMaterialForUser(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const blueprint = await getBlueprintForMaterial(material).catch(() => null);
  const exams = (await listExamSummaries(user)).filter((summary) => summary.exam.materialId === id);

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <p className="small muted">
          <Link href="/materials">← 返回材料列表</Link>
        </p>
        <h1>{material.title}</h1>
        <p className="muted small">
          {material.rawText.length} 字符 · 约 {material.tokenCount} tokens · 上传于{" "}
          {new Date(material.createdAt).toLocaleString("zh-CN")}
        </p>

        <section className="card">
          <h2>材料原文（预览）</h2>
          <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>
            {truncate(material.rawText, 900)}
          </p>
        </section>

        {!blueprint ? (
          <section className="card">
            <h2>第一步：切分知识点</h2>
            <p className="muted small">
              出题必须基于知识点，否则会得到一堆散题。生成大纲只依据材料本身，不会引入材料外的知识。
            </p>
            <GenerateOutlineButton materialId={material.id} />
          </section>
        ) : (
          <section className="card">
            <div className="row row--between">
              <h2 style={{ margin: 0 }}>第二步：确认知识点并生成试卷</h2>
              <span className="pill">
                {blueprint.topics.length} 个知识点 · {blueprint.generatorModel}
              </span>
            </div>
            <div className="divider" />
            <ExamBuilder
              materialId={material.id}
              topics={blueprint.topics}
              defaultCount={DEFAULT_QUESTION_COUNT}
              minCount={MIN_QUESTION_COUNT}
              maxCount={MAX_QUESTION_COUNT}
              defaultMix={DEFAULT_QUESTION_MIX}
            />
          </section>
        )}

        <section className="card">
          <h2>该材料下的试卷</h2>
          {exams.length === 0 ? (
            <div className="empty">还没有试卷。</div>
          ) : (
            <div className="stack">
              {exams.map((summary) => (
                <div key={summary.exam.id} className="row row--between">
                  <div>
                    <strong>{summary.exam.title}</strong>
                    <div className="small muted">
                      {summary.exam.config.count} 题 ·{" "}
                      {summary.latestAttempt
                        ? `最近 ${summary.latestAttempt.scorePercent ?? 0} 分`
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
      </main>
    </>
  );
}
