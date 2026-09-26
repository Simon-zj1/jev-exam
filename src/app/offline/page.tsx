import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { APP_NAME } from "@/lib/config";

export const metadata = { title: `离线 · ${APP_NAME}` };

/**
 * 离线兜底页。
 *
 * 只做「说清楚」这一件事：哪些能用、哪些必须联网。
 * 不假装离线可用——把不能用的部分讲明白，比给一个转圈的空页面诚实得多。
 */
export default function OfflinePage() {
  return (
    <main className="shell" style={{ paddingTop: "var(--s7)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "var(--s5)" }}>
        <BrandMark size={28} />
        <strong style={{ fontSize: 18 }}>{APP_NAME}</strong>
      </div>

      <h1>现在没有网络</h1>
      <p className="lede">
        这一页是离线兜底。网页版的核心能力（出题、判定、材料问答）都在服务端调用模型，
        所以断网时它们不可用——这是取舍，不是故障。
      </p>

      <section className="section">
        <h2>断网时仍然可用</h2>
        <div className="list">
          <div className="list__row">
            <div>
              <strong>已导出到本地的文件</strong>
              <div className="small muted">Markdown / Anki CSV / 备份 JSON 一旦导出，就是普通文件，离线照常打开。</div>
            </div>
          </div>
          <div className="list__row">
            <div>
              <strong>命令行与 Agent Skill</strong>
              <div className="small muted">
                <code>npx jev-exam grade --material m.md --exam exam.json --engine offline</code>{" "}
                可以在完全离线的情况下校验与判定（离线引擎只用于演示）。
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>需要联网</h2>
        <div className="list">
          <div className="list__row">
            <div>
              <strong>上传解析、出题、判定、材料问答</strong>
              <div className="small muted">这些都要调用模型服务，断网或服务商不可用时无法完成。</div>
            </div>
          </div>
        </div>
      </section>

      <div className="row" style={{ marginTop: "var(--s6)" }}>
        <Link className="btn btn--primary" href="/">
          重试
        </Link>
      </div>
    </main>
  );
}
