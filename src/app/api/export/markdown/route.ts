import type { NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { downloadResponse, stamp } from "@/lib/http/download";
import { buildMarkdownExport } from "@/lib/services/export";

export const runtime = "nodejs";

/** Markdown 导出：材料正文 + 题目与评分点 + 学习状态，离线也能读。 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const markdown = await buildMarkdownExport(user);
    return downloadResponse({
      content: markdown,
      asciiName: `jev-exam-${stamp()}.md`,
      fileName: `jev-exam-学习资料-${stamp()}.md`,
      contentType: "text/markdown",
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
