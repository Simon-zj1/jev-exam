import type { NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { downloadResponse, stamp } from "@/lib/http/download";
import { buildAnkiCsv } from "@/lib/services/export";

export const runtime = "nodejs";

/** Anki 可导入的 CSV：把复习卡片搬进用户已有的工具，不被本站锁住。 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const csv = await buildAnkiCsv(user);
    return downloadResponse({
      content: csv,
      asciiName: `jev-exam-anki-${stamp()}.csv`,
      fileName: `jev-exam-Anki卡片-${stamp()}.csv`,
      contentType: "text/csv",
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
