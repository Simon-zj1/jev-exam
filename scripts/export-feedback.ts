#!/usr/bin/env tsx
/**
 * 把用户提交的纠错导出成金标准候选。
 *
 * 「用户说判错了」不等于「真的判错了」，所以这里只导出候选，不自动并入评测集：
 * 需要人工逐条确认标签后，才手工追加到 eval/golden/subjective.jsonl。
 * 这样金标准集才会随使用量自然长大，而不是靠我们自己编题。
 *
 * 用法：
 *   npm run feedback:golden                      # 打印到标准输出
 *   npm run feedback:golden -- --out fb.jsonl    # 写入文件
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapStore } from "../src/lib/db/index";
import { buildFeedbackCandidates } from "../src/lib/services/export";

async function main(): Promise<void> {
  await bootstrapStore();
  const content = await buildFeedbackCandidates();

  if (!content.trim()) {
    console.log("目前没有纠错上报。用户提交后，这里会列出可人工确认的候选。");
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

  if (out) {
    writeFileSync(resolve(process.cwd(), out), `${content}\n`, "utf8");
    console.log(`已写入 ${lines.length} 条候选：${out}`);
    console.log("请人工确认标签后，再追加到 eval/golden/subjective.jsonl。");
    return;
  }

  console.log(`# 纠错候选 ${lines.length} 条（人工确认后才并入 eval/golden）`);
  console.log(content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
