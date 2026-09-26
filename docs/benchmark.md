# 主观题判定基准（Jev Exam Grading Benchmark）

这份基准回答一个具体问题：**「一句话说没说中一个要点」这件事，机器判得准不准，准到什么程度？**

它不是通用大模型评测，而是一个窄而硬的二分类任务：给定一道简答题的得分点、材料原文依据、
学生作答，判断该得分点是否命中。标注单位是「得分点」，不是题目——一道题 3–6 个点，
所以 12 道题就有 42 个标注点。

## 数据

- 文件：[eval/golden/subjective.jsonl](../eval/golden/subjective.jsonl)
- 规模：12 道主观题 / 42 个逐点人工标注（当前）
- 每行字段：

```json
{
  "id": "sa-001",
  "topic": "检索",
  "materialExcerpt": "材料原文片段（判定时的证据上下文）",
  "question": {
    "stem": "题干",
    "reference_answer": "参考答案",
    "rubric_points": [{ "point_id": "p1", "statement": "可判定真假的命题", "weight": 1, "evidence_span": "材料里的依据" }]
  },
  "answerText": "学生作答原文",
  "labels": { "p1": true, "p2": false }
}
```

`labels` 是人工标注的真值：`true` 表示这句作答确实说到了该得分点。

## 复现

```bash
npm run benchmark            # 离线演示引擎 + 写出机器可读结果
npm run eval:judge -- --enforce --consistency 5   # 带门槛与自一致性
npm run eval:judge -- --json /tmp/result.json     # 任意引擎，输出 JSON
```

接入真实判定引擎（TypeSafe Jev）后跑同一条命令即可对比：

```bash
TYPESAFE_API_KEY=... npm run eval:judge -- --json docs/benchmark-jev.json
```

## 指标

| 指标 | 含义 | 门槛 |
| --- | --- | --- |
| 逐点准确率 | 命中/未命中判断与人工标注的一致比例 | ≥ 90% |
| Brier 分数 | 概率预测的均方误差，越低越好（0.25 = 无信息） | 只看趋势 |
| 校准分桶 | 按判定置信度分组后的实际准确率是否单调递增 | 必须单调 |
| 待复核比例 | 判定强度不足、被标为「待复核」的题目占比 | 不作为门槛 |
| 自一致性 | 同一题重复判定 N 次，首点概率的标准差 | 越低越好 |

门槛刻意设成两个：准确率是下限，校准单调是「置信度有没有意义」的检验。
一个模型可以准确率不低但置信度全挤在一档——那样的置信度无法用来做门控，
也就无法实现「不确定就标出来」。

## 当前结果（离线演示引擎）

来自 [docs/benchmark-results.json](benchmark-results.json)（`npm run benchmark` 生成）：

| 引擎 | 逐点准确率 | Brier | 校准单调 | 待复核 | 自一致性 |
| --- | --- | --- | --- | --- | --- |
| `lexical-demo`（词面近似，仅演示） | 71.4% | 0.216 | 通过 | 9 / 12 | 0.0000 |
| `typesafe`（Jev，需 key） | 待测 | 待测 | 待测 | 待测 | 待测 |

离线引擎的数字正好说明问题：它靠词面重合能蒙对七成，但 12 道题里有 9 道判定强度不足，
也就是**它自己都知道自己不确定**。接入校准过的决策模型才有意义。

> 上表里 Jev 一行保持「待测」，是因为这个仓库不携带 API key，任何人都可以在自己环境里
> 跑出这一行并提交 PR。宁可留空，也不写没有复现命令的数字。

## 怎么贡献标注

1. 使用线上应用时，遇到判错的题目点结果页的「这题判错了？」；
2. 运行 `npm run feedback:golden -- --out fb.jsonl` 导出候选；
3. 人工确认 `labels` 后追加到 `eval/golden/subjective.jsonl`，提 PR。

目标规模是 60–100 题、300+ 个标注点，并按知识点分层，让每个知识点都有足够样本。

## 许可

标注数据采用与仓库相同的 [MIT](../LICENSE) 许可。用于论文或对比实验时请注明来源。
