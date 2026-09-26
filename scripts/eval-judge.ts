/**
 * 判定层评测脚本。
 *
 * 用法：
 *   npm run eval:judge                      # 用当前环境配置的引擎跑一遍
 *   npm run eval:judge -- --engine offline  # 强制离线词面引擎（演示）
 *   npm run eval:judge -- --enforce         # 不达门槛时以退出码 1 失败
 *   npm run eval:judge -- --consistency 5   # 额外做自一致性检查
 *   npm run eval:judge -- --json out.json   # 输出机器可读结果（用于公开榜单/回归对比）
 *
 * 金标准集在 eval/golden/subjective.jsonl：每行一道主观题 + 学生作答 + 逐得分点人工标注。
 * 扩大标注集是提升判定可信度最有效的一步。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveDecisionEngine } from "../src/lib/engine/index";
import { LexicalJudgeEngine } from "../src/lib/engine/lexical";
import { TypeSafeEngine } from "../src/lib/engine/typesafe";
import { gradeShortAnswer } from "../src/lib/grading/subjective";
import type { DecisionEngine, ShortAnswerQuestion } from "../src/lib/types";

const here = dirname(fileURLToPath(import.meta.url));

type GoldenItem = {
  id: string;
  topic: string;
  materialExcerpt: string;
  question: {
    stem: string;
    reference_answer: string;
    rubric_points: ShortAnswerQuestion["rubric_points"];
  };
  answerText: string;
  labels: Record<string, boolean>;
};

type PointRecord = {
  itemId: string;
  pointId: string;
  probability: number;
  strength: number;
  awarded: boolean;
  label: boolean;
  needsReview: boolean;
};

function parseArgs(argv: string[]) {
  const args = {
    engine: undefined as string | undefined,
    enforce: false,
    consistency: 0,
    json: undefined as string | undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--enforce") args.enforce = true;
    if (value === "--engine") args.engine = argv[++index];
    if (value === "--consistency") args.consistency = Number(argv[++index] ?? 0);
    if (value === "--json") args.json = argv[++index];
  }
  return args;
}

function loadGolden(): GoldenItem[] {
  const path = resolve(here, "../eval/golden/subjective.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as GoldenItem);
}

function pickEngine(name?: string): { engine: DecisionEngine; label: string } {
  if (name === "offline") {
    return { engine: new LexicalJudgeEngine(), label: "offline-lexical（演示引擎）" };
  }
  if (name === "typesafe") {
    const engine = TypeSafeEngine.fromEnv();
    if (!engine) throw new Error("--engine typesafe 需要 TYPESAFE_API_KEY");
    return { engine, label: `typesafe (${engine.model})` };
  }
  const selection = resolveDecisionEngine({});
  return { engine: selection.engine, label: `${selection.engine.id} / ${selection.mode}` };
}

function accuracy(records: PointRecord[]): number {
  if (records.length === 0) return 0;
  const correct = records.filter((record) => record.awarded === record.label).length;
  return correct / records.length;
}

function brier(records: PointRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, record) => {
    const target = record.label ? 1 : 0;
    return sum + (record.probability - target) ** 2;
  }, 0);
  return total / records.length;
}

function calibrationBuckets(records: PointRecord[], bucketCount = 5) {
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    range: `${(index / bucketCount).toFixed(1)}–${((index + 1) / bucketCount).toFixed(1)}`,
    items: [] as PointRecord[],
  }));
  for (const record of records) {
    const target = record.label ? 1 : 0;
    const confidence = record.awarded ? record.probability : 1 - record.probability;
    const index = Math.min(bucketCount - 1, Math.floor(confidence * bucketCount));
    buckets[index].items.push({ ...record, probability: confidence, label: target === 1 });
  }
  return buckets.map((bucket) => ({
    range: bucket.range,
    count: bucket.items.length,
    meanConfidence:
      bucket.items.length === 0
        ? 0
        : bucket.items.reduce((sum, item) => sum + item.probability, 0) / bucket.items.length,
    actualAccuracy: accuracy(bucket.items),
  }));
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { engine, label } = pickEngine(args.engine);
  const items = loadGolden();
  const records: PointRecord[] = [];
  const flaggedItems: string[] = [];
  const engineErrors: string[] = [];

  for (const item of items) {
    const question: ShortAnswerQuestion = {
      id: item.id,
      topic_id: item.topic,
      type: "short_answer",
      stem: item.question.stem,
      reference_answer: item.question.reference_answer,
      rubric_points: item.question.rubric_points,
      difficulty: "medium",
      source_anchor: item.materialExcerpt,
    };

    try {
      const judgment = await gradeShortAnswer({
        question,
        answerText: item.answerText,
        engine,
        materialExcerpt: item.materialExcerpt,
      });
      if (judgment.needsReview) flaggedItems.push(item.id);
      for (const point of judgment.points) {
        const pointLabel = item.labels[point.point_id];
        if (pointLabel === undefined) continue;
        records.push({
          itemId: item.id,
          pointId: point.point_id,
          probability: point.probability,
          strength: point.strength,
          awarded: point.awarded,
          label: pointLabel,
          needsReview: judgment.needsReview,
        });
      }
    } catch (error) {
      engineErrors.push(`${item.id}: ${(error as Error).message}`);
    }
  }

  const perPointAccuracy = accuracy(records);
  const brierScore = brier(records);
  const buckets = calibrationBuckets(records);
  const monotonic = buckets
    .filter((bucket) => bucket.count >= 2)
    .every((bucket, index, list) =>
      index === 0 ? true : bucket.actualAccuracy >= list[index - 1].actualAccuracy - 0.15,
    );

  console.log(`\n判定层评测 · 引擎：${label}`);
  console.log(`金标准：${items.length} 道主观题，${records.length} 个得分点标注`);
  if (engineErrors.length > 0) {
    console.log(`调用失败：${engineErrors.length} 例（${engineErrors.slice(0, 3).join(" | ")}）`);
  }
  console.log(`\n逐点准确率：${(perPointAccuracy * 100).toFixed(1)}%`);
  console.log(`Brier 分数（越低越好）：${brierScore.toFixed(4)}`);
  console.log(`待复核题目：${flaggedItems.length} / ${items.length}`);

  console.log("\n校准分桶（按“判定倾向”的置信度分组）：");
  console.log("  区间        样本   平均置信   实际准确率");
  for (const bucket of buckets) {
    console.log(
      `  ${bucket.range.padEnd(10)}  ${String(bucket.count).padStart(4)}   ${bucket.meanConfidence
        .toFixed(2)
        .padStart(8)}   ${(bucket.actualAccuracy * 100).toFixed(1).padStart(8)}%`,
    );
  }
  console.log(`\n校准单调性：${monotonic ? "通过" : "未通过（高置信分组准确率反而更低）"}`);

  if (args.consistency > 1) {
    const target = items[0];
    const repeats: number[] = [];
    for (let index = 0; index < args.consistency; index += 1) {
      const judgment = await gradeShortAnswer({
        question: {
          id: target.id,
          topic_id: target.topic,
          type: "short_answer",
          stem: target.question.stem,
          reference_answer: target.question.reference_answer,
          rubric_points: target.question.rubric_points,
          difficulty: "medium",
          source_anchor: target.materialExcerpt,
        },
        answerText: target.answerText,
        engine,
        materialExcerpt: target.materialExcerpt,
      });
      repeats.push(judgment.points[0]?.probability ?? 0.5);
    }
    console.log(
      `\n自一致性（同一题重复 ${args.consistency} 次，首点概率标准差）：${stdDev(repeats).toFixed(4)}`,
    );
  }

  const thresholds = { accuracy: 0.9, calibration: true };
  const passed = perPointAccuracy >= thresholds.accuracy && monotonic;
  console.log(
    `\n门槛：逐点准确率 ≥ ${(thresholds.accuracy * 100).toFixed(0)}% 且校准单调 → ${
      passed ? "通过" : "未通过"
    }`,
  );

  if (args.enforce && !passed) {
    console.error("\n未达门槛，退出码 1。");
    process.exit(1);
  }

  // 机器可读结果：公开榜单与回归对比都读这个文件，避免靠人眼抄数字
  if (args.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      engine: { id: engine.id, model: engine.model, requested: args.engine ?? "auto" },
      goldenSet: {
        file: "eval/golden/subjective.jsonl",
        itemCount: items.length,
        pointCount: records.length,
      },
      metrics: {
        perPointAccuracy,
        brierScore,
        flaggedItems: flaggedItems.length,
        calibrationMonotonic: monotonic,
        buckets: buckets.map((bucket) => ({
          range: bucket.range,
          count: bucket.count,
          meanConfidence: bucket.meanConfidence,
          actualAccuracy: bucket.actualAccuracy,
        })),
      },
      thresholds,
      passed,
    };
    writeFileSync(
      resolve(process.cwd(), args.json),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
    console.log(`\n已写入机器可读结果：${args.json}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
