import { NextResponse } from "next/server";
import { storeDriver } from "@/lib/db";
import { engineStatus } from "@/lib/services/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 健康检查：给部署与监控用，不泄露任何用户数据。
 *
 * 只回答三件事：进程活着吗、数据层是哪一种、当前跑的是哪个判定/出题引擎。
 * 最后一项对排查特别有用——线上「分数很怪」十有八九是掉进了离线演示模式，
 * 而这件事以前只能登录后进设置页才看得到。
 */
export async function GET() {
  const status = engineStatus();
  return NextResponse.json(
    {
      ok: true,
      time: new Date().toISOString(),
      store: storeDriver(),
      engines: {
        judge: status.judgeEngine,
        judgeMode: status.judgeMode,
        generator: status.generator,
        generatorMode: status.generatorMode,
        demoMode: status.demoMode,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
