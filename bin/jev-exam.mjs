#!/usr/bin/env node
/**
 * npx / 全局安装的入口。
 *
 * 这个包不预编译 TypeScript：源码就是可执行体，用 tsx 直接跑，
 * 这样 `npx jev-exam` 拿到的永远是和仓库一致的实现，不需要构建步骤。
 *
 *   npx jev-exam verify --material m.md --exam exam.json --strict
 *   npx jev-exam mcp            # 以 MCP server 方式运行（stdio）
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);

const [, scriptName, ...rest] = args;
const script =
  scriptName === "mcp" ? join("scripts", "mcp-server.ts") : join("scripts", "study.ts");
const forwarded = scriptName === "mcp" ? rest : args;

let tsxEntry;
try {
  tsxEntry = createRequire(import.meta.url).resolve("tsx");
} catch {
  console.error(
    "缺少运行依赖 tsx。请先在该目录执行 `npm install`，或改用 `npx -y jev-exam@latest`。",
  );
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", tsxEntry, script, ...forwarded], {
  cwd: root,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
