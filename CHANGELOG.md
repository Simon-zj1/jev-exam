# 更新日志

## v0.2.0 · 2026-09-24

### 新增

- **溯源契约**：材料事实（`source_anchor`、`evidence_span`）与模型补充（题干、参考答案、得分点表述、
  判定概率）显式分离，前者必须在原文中逐字定位，否则记为违规（`src/lib/provenance.ts`）。
- **覆盖率校验**：把材料切成要点单位，列出没有被任何题目覆盖的部分，报告与页面如实显示
  「覆盖 9/14」以及未覆盖的句子（`src/lib/coverage.ts`）。
- **不可信材料处理**：扫描并要求出题模型把材料当数据（`src/lib/security/untrusted.ts`），
  检测提示注入、角色劫持、脚本注入、分隔符冲突等模式；拼接提示词前转义分隔符。
- **命令行工具**：`scripts/study.ts` 提供 `verify` / `grade` / `render` / `answer-template` / `demo`
  五个子命令，可脱离 Web 应用直接校验、判定并产出离线静态报告。
- **Agent Skill 入口**：`SKILL.md`，可在 Codex / Claude Code 等支持 Agent Skills 的环境里直接使用。
- **离线演示报告**：`docs/demo/report.html`，由上面的工具链生成，打开即可看到逐点判定与覆盖情况。
- **仓库门面**：MIT LICENSE、SECURITY.md、英文 README、Banner、requirements 与兼容性说明。

### 变更

- `noul` 问题不再共享同一段指令：每个得分点的问题自带它所判的那一点（否则模型无法区分在判哪一点）。
- 离线演示引擎会解析指令里的路径引用（如 `point.statement`），并且不再把学生自己的作答混进比对目标。
- Markdown 标题不再被当作知识要点或覆盖单位。
- 出处定位从「第 N 段」改为「第 N 句 / 共 M 句」，更贴近实际的知识点粒度。

### 验证

- 单元 / 集成测试覆盖判定、门控、覆盖率、溯源契约、注入扫描、报告渲染与 Postgres 数据层（PGlite 实测）。
- 判定评测脚本内置金标准集（12 道主观题 / 42 个得分点），门槛为逐点准确率 ≥ 90% 且校准单调。

## v0.1.0 · 2026-09-23

- 首个版本：材料上传 → 知识点切分 → 出题 → 逐得分点判定 → 错题本与掌握度。
- 判定层抽象为 `DecisionEngine`（TypeSafe Jev / LLM 基线 / 离线演示）。
- 邀请制登录、每日额度、BYOK 加密存储、Postgres + 内存双实现。
