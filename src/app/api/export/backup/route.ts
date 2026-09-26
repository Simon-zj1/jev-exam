import type { NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { downloadResponse, stamp } from "@/lib/http/download";
import { buildBackup } from "@/lib/services/export";

export const runtime = "nodejs";

/** 完整数据备份（JSON）：材料、题目、作答、判定、掌握度、复习卡、纠错、用量。 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const bundle = await buildBackup(user);
    return downloadResponse({
      content: JSON.stringify(bundle, null, 2),
      asciiName: `jev-exam-backup-${stamp()}.json`,
      fileName: `jev-exam-备份-${stamp()}.json`,
      contentType: "application/json",
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
