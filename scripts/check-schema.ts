#!/usr/bin/env tsx
/**
 * 校验「仓库里的迁移」与「schema.ts 描述的结构」是否一致。
 *
 * 起因：生产库是用 drizzle-kit push 直接推的，而仓库里另有一套版本化迁移，
 * 两者从未被要求一致——迁移文件可以悄悄落后于 schema.ts，而没人会发现。
 * 这个检查在 PGlite 里跑一遍真实迁移，再把结果与最新一份 drizzle 快照逐表逐列比对。
 *
 * 用法：npm run schema:check（CI 里跑）
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

type Snapshot = {
  tables: Record<string, { columns: Record<string, unknown> }>;
};

function latestSnapshot(): Snapshot {
  const metaDir = resolve(process.cwd(), "drizzle/meta");
  const snapshots = readdirSync(metaDir)
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
    .sort();
  const latest = snapshots[snapshots.length - 1];
  if (!latest) throw new Error("drizzle/meta 下没有快照文件");
  return JSON.parse(readFileSync(resolve(metaDir, latest), "utf8")) as Snapshot;
}

function migrationFiles(): { name: string; sql: string }[] {
  const dir = resolve(process.cwd(), "drizzle");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(resolve(dir, name), "utf8") }));
}

async function main(): Promise<void> {
  const snapshot = latestSnapshot();
  const migrations = migrationFiles();
  if (migrations.length === 0) throw new Error("drizzle/ 下没有迁移文件");

  const pg = new PGlite();
  for (const migration of migrations) {
    // 迁移文件里用 --> statement-breakpoint 分隔语句
    for (const statement of migration.sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await pg.exec(statement);
    }
  }

  const expected = Object.entries(snapshot.tables)
    .filter(([key]) => key.startsWith("public."))
    .map(([key, table]) => ({
      name: key.replace("public.", ""),
      columns: Object.keys(table.columns).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = await pg.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' order by table_name, column_name`,
  );
  const actual = new Map<string, string[]>();
  for (const row of rows.rows) {
    const list = actual.get(row.table_name) ?? [];
    list.push(row.column_name);
    actual.set(row.table_name, list);
  }

  const problems: string[] = [];
  for (const table of expected) {
    const columns = actual.get(table.name);
    if (!columns) {
      problems.push(`迁移没有建出表 ${table.name}`);
      continue;
    }
    const missing = table.columns.filter((column) => !columns.includes(column));
    const extra = columns.filter((column) => !table.columns.includes(column));
    if (missing.length > 0) problems.push(`${table.name} 缺少列：${missing.join(", ")}`);
    if (extra.length > 0) problems.push(`${table.name} 多出列：${extra.join(", ")}`);
  }
  for (const name of actual.keys()) {
    if (!expected.some((table) => table.name === name)) {
      problems.push(`迁移多建了表 ${name}（schema.ts 里没有）`);
    }
  }

  await pg.close();

  if (problems.length > 0) {
    console.error(`✗ schema 与迁移不一致（${problems.length} 处）：`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("\n请先跑 npm run db:generate 生成迁移，再提交。");
    process.exit(1);
  }
  console.log(`✓ ${expected.length} 张表、${migrations.length} 个迁移与 schema.ts 一致`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
