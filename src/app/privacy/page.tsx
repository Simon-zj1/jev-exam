import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** 隐私说明：如实写清「存了什么、发给谁、怎么删」，不写空话。 */
export default async function PrivacyPage() {
  const user = await getCurrentUser();

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>隐私说明</h1>
        <p className="muted small">
          这份说明描述本站实际处理的数据。它跟着代码走：改动数据处理逻辑时，这一页必须同步更新。
        </p>

        <section className="card">
          <h2>我们存了什么</h2>
          <ul className="small muted">
            <li>账号：邮箱地址、创建时间。没有密码，登录靠邀请码 + 邮箱签发的会话 Cookie。</li>
            <li>
              你上传或粘贴的材料正文，以及上传解析得到的来源信息（文件名、页码映射、上传体检结论）。
            </li>
            <li>由材料派生的知识点、题目、评分点、试卷顺序。</li>
            <li>你的作答原文、判定结果（分数、逐得分点概率、待复核原因）、掌握度与复习排期。</li>
            <li>你对判定结果的纠错上报（含上报时冻结的题目与判定快照）。</li>
            <li>每日额度计数与模型调用的 token / 估算费用（按天与模型聚合，不含内容）。</li>
          </ul>
        </section>

        <section className="card">
          <h2>什么内容会离开本站</h2>
          <ul className="small muted">
            <li>
              出题、材料问答与判定需要调用模型：会把<strong>相关材料片段、题目与你的作答</strong>
              发给相应的模型服务商。发给哪家取决于你配置的 Key，或本站部署时配置的平台 Key。
            </li>
            <li>每次请求只发送完成该次任务所需的内容，不会把整份材料无差别地全量上传。</li>
            <li>会话 Cookie 为 HttpOnly 签名 Cookie；你的 API Key 加密存储，不会回显给浏览器。</li>
          </ul>
        </section>

        <section className="card">
          <h2>不做什么</h2>
          <ul className="small muted">
            <li>不用你的材料训练模型。</li>
            <li>不把材料公开、不做分享链接、不做用户之间的可见性。</li>
            <li>不把你的数据卖给第三方。</li>
          </ul>
        </section>

        <section className="card">
          <h2>你的控制权</h2>
          <ul className="small muted">
            <li>
              随时在<Link href="/settings">设置</Link>
              里导出全部数据（Markdown / Anki CSV / 完整 JSON 备份）。
            </li>
            <li>删除单份材料会连带删除它派生的大纲、题目、作答与判定记录。</li>
            <li>
              删除账号会清空全部数据且不可恢复。入口在<Link href="/settings">设置</Link>页底部。
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>联系</h2>
          <p className="small muted">
            数据相关问题可以通过{" "}
            <a href="https://github.com/Simon-zj1/jev-exam/issues" rel="noopener">
              GitHub Issues
            </a>{" "}
            提出。也可以查看<Link href="/terms">服务条款</Link>。
          </p>
        </section>
      </main>
    </>
  );
}
