# 部署到 Web（Vercel + Postgres）

目标：把 Web 端跑在公网上，接进个人网站作为入口。全程约 20 分钟，免费额度够用。

## 当前部署状态（2026-09-25）

| 项 | 值 |
| --- | --- |
| Vercel 项目 | `simon-zj1s-projects/jev-exam`（已联通 GitHub 仓库，push 自动部署） |
| 生产地址 | https://jev-exam.vercel.app |
| 自定义域名 | `exam.simon-zj.top`（已加到项目，等待阿里云 DNS 的 A 记录生效） |
| 数据库 | Neon（通过 Vercel 市场集成接入，自动注入 `DATABASE_URL` 等变量） |
| 已设置的环境变量 | `SESSION_SECRET`、`INITIAL_INVITE_CODES`（Production + Preview）、Neon 注入的 `DATABASE_URL` 系列 |
| 已关闭 | Deployment Protection（Vercel Authentication 默认开启会把所有人挡在门外） |

重新部署与建表：

```bash
vercel --prod --yes                                  # 部署
vercel env pull /tmp/jev-prod.env --environment=production --yes
set -a; source /tmp/jev-prod.env; set +a
export DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
npx drizzle-kit push --force                          # 建表 / 同步 schema
```

> 注意：`*.vercel.app` 在国内部分网络会被 TLS 重置（实测直连 000、走代理 200，而 `vercel.com`
> 直连正常）。所以**必须绑定自定义域名**并对国内可达性做验证；长期面向国内用户建议国内云主机 + 备案。

## 0. 先要一个临时公网地址？（2 分钟，验证用）

如果只是想先在手机上试，不必等 Vercel。在本机跑生产构建，再用 Cloudflare 的临时隧道暴露出去：

```bash
cd ~/Documents/ChatGPT/Ski
npm run build
SESSION_SECRET="$(openssl rand -base64 32)" INITIAL_INVITE_CODES="MY-INVITE" npx next start -p 3211
# 另开一个终端：
cloudflared tunnel --url http://localhost:3211     # 输出 https://xxx.trycloudflare.com
```

优点：不用账号、几分钟内手机就能打开；缺点：**进程一停地址就失效**，且数据存在内存里（重启即清空）。
正式上线请继续下面的步骤。

> 为什么不能直接放进现在的个人网站：`www.simon-zj.top` 是 Hexo 生成的**静态站点**（GitHub Pages），
> 只能托管 HTML/CSS/JS；本应用需要 Node 服务端（调用模型、读写数据库、签名会话）。
> 所以做法是：应用部署到 Vercel，网站上加一个入口链接与卡片。

## 1. 准备数据库（5 分钟）

任选一家托管 Postgres：

- **Neon**：https://neon.tech → 新建项目 → 复制 `postgresql://...` 连接串
- **Supabase**：https://supabase.com → Project Settings → Database → Connection string

拿到形如 `postgresql://user:pass@host/db?sslmode=require` 的连接串即可。

## 2. 部署到 Vercel（10 分钟）

最快的方式是仓库里已经放好的 Deploy Button：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSimon-zj1%2Fjev-exam&env=AI_API_KEY&envDescription=%E5%87%BA%E9%A2%98%E6%A8%A1%E5%9E%8B%E7%9A%84%20key&project-name=jev-exam&repository-name=jev-exam)

或者用命令行：

```bash
npm i -g vercel
vercel login
cd /Users/simon-zj/Documents/ChatGPT/Ski
vercel --prod
```

在 Vercel 项目的 **Settings → Environment Variables** 里填这几项（Production 与 Preview 都勾上）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | 上一步拿到的 Postgres 连接串 |
| `SESSION_SECRET` | ✅ | 随机 32 字节，例如 `openssl rand -base64 32` |
| `INITIAL_INVITE_CODES` | ✅ | 邀请码，逗号分隔（例如 `SIMON-2026`） |
| `AI_API_KEY` | 可选 | 出题模型的 Key；不填则运行在演示模式 |
| `AI_PROVIDER` | 可选 | 国内 Key 建议显式指定：`deepseek` / `zhipu` / `qwen` / `moonshot` |
| `TYPESAFE_API_KEY` | 可选 | Jev 判定引擎；不填则用通用模型判分 |

部署完成后先把表结构推上去（只做一次）：

```bash
DATABASE_URL="postgresql://..." npm run db:push
```

## 3. 绑定自己的域名（可选，5 分钟）

在 Vercel → Settings → Domains 添加 `exam.simon-zj.top`，然后到域名服务商加一条 CNAME：

```
exam.simon-zj.top  CNAME  cname.vercel-dns.com
```

> 大陆访问速度：Vercel 的香港节点（`vercel.json` 里已设 `"regions": ["hkg1"]`）通常可用但不保证稳定。
> 若后续主要面向大陆用户，再考虑迁到国内云主机 + 域名备案（这一步涉及备案，需单独规划）。

## 4. 把入口挂到个人网站

入口链接在 `source/tech/tools/jev-exam/index.md` 里，改一处即可：

```md
<a class="button button--primary" href="https://exam.simon-zj.top/">打开应用</a>
```

改完执行 `npm run deploy`（blog 目录）。

## 5. 上线检查清单

- [ ] 打开线上地址，用邀请码登录成功
- [ ] 设置页 → 选服务商 → 粘 Key → **测试连接** 显示"已连通"
- [ ] 上传一段材料 → 生成大纲 → 生成试卷 → 作答 → 看到逐点判定报告
- [ ] 断网/未配置 Key 时，界面明确显示"演示模式"而不是报错
- [ ] 删除材料后，其试卷与判定记录一并消失（设置页有说明）
- [ ] SECURITY.md 的《公网部署前清单》逐条确认（给 Key 设消费上限、保持邀请制、加限流）

## 常见问题

**构建失败**：Vercel 默认识别 Next.js；若手动改了 Root Directory，请确认指向仓库根目录。

**登录后立刻退出**：`SESSION_SECRET` 没设或每次部署都变，会导致签名 Cookie 失效。

**出题报 401/404**：在设置页点"测试连接"，会给出中文原因（Key 无效 / 模型名不对 / 网络不可达）。

**数据库连不上**：Neon/Supabase 免费实例闲置会休眠，第一次请求可能慢几秒；连接串要带 `sslmode=require`。
