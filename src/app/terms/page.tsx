import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * 服务条款。
 *
 * 重点是三条容易被忽略但必须写明的：上传材料必须自己有权使用、
 * 生成内容可能出错且不构成学业或职业建议、纠错与下架的联系渠道。
 */
export default async function TermsPage() {
  const user = await getCurrentUser();

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <h1>服务条款</h1>
        <p className="muted small">最后更新：2026-09-26</p>

        <section className="card">
          <h2>1. 你上传的内容</h2>
          <ul className="small muted">
            <li>
              你只能上传自己有权使用的内容（自己的笔记、自己购买的教材的个人使用、
              公开授权的资料等）。上传受版权保护的材料时，请自行确认在你的使用场景下是合规的。
            </li>
            <li>
              本站不提供任何公开分享功能：材料、试卷与判定结果只有你本人可见，
              不会生成对外链接，也不做用户之间的可见性。
            </li>
            <li>
              如果你是权利人，认为本站某处内容侵犯了你的权利，请通过{" "}
              <a href="https://github.com/Simon-zj1/jev-exam/issues" rel="noopener">
                GitHub Issues
              </a>{" "}
              联系我们并提供权利证明与定位信息，我们会核实并删除相关内容。
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>2. 生成内容与判定结果</h2>
          <ul className="small muted">
            <li>
              题目、参考答案、评分点与答疑回答都由模型生成，<strong>可能出错</strong>。
              它是学习辅助工具，不构成学业评价、考试结论或任何专业建议。
            </li>
            <li>
              判定结果是模型给出的概率与据此合成分数，不是事实判断。判定强度不足的题目会被标记为
              「待复核」，给出分数区间，并且不计入掌握度。
            </li>
            <li>
              每个结果页都有「这题判错了？」入口。你的上报会被记录下来用于人工复核，
              并可能（在你提交的范围内）用于改进判定质量。
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>3. 账号与额度</h2>
          <ul className="small muted">
            <li>本站目前是邀请制。请勿把邀请码公开传播或用于批量注册。</li>
            <li>每人每日有上传、出题、判定与问答的额度上限；使用自带密钥（BYOK）的调用不计入平台额度。</li>
            <li>请勿利用本站进行违法内容处理、攻击性请求或任何试图绕过安全边界的行为。</li>
          </ul>
        </section>

        <section className="card">
          <h2>4. 可用性与变更</h2>
          <ul className="small muted">
            <li>本站为个人项目，不承诺可用性；模型服务商故障会直接影响出题与判定。</li>
            <li>
              数据处理方式见<Link href="/privacy">隐私说明</Link>。我们会保持这一页与代码行为一致，
              有实质变更时会在页首更新日期。
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
