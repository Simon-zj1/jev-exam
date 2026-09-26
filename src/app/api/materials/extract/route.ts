import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { MAX_UPLOAD_LABEL } from "@/lib/config";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { extractMaterialFromFile } from "@/lib/ingest";
import { rateLimitResponse } from "@/lib/http/rate-guard";

/** pdfjs 与 mammoth 都只能在 Node 运行时跑，且解析大 PDF 需要更长时间。 */
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 解析上传的 PDF / Word / 文本。
 *
 * 只做解析、不落库、不计额度：用户要先看到解析结果（并可以改标题、删掉解析错的段落）
 * 再决定保存，所以真正的材料创建仍走 POST /api/materials。
 */
export async function POST(request: NextRequest) {
  try {
    // 解析要跑 pdfjs，是单次成本最高的接口，先限流再读文件体
    const limited = rateLimitResponse(request, "extract");
    if (limited) return limited;

    await requireUserFromRequest(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ValidationError("上传格式不正确，请重新选择文件。");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("没有收到文件，请重新选择。");
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const { result, sourceMap } = await extractMaterialFromFile({
      buffer,
      fileName: file.name,
    });

    return NextResponse.json({
      extraction: {
        kind: result.kind,
        title: result.title,
        text: result.text,
        pageCount: result.pageCount,
        warnings: result.warnings,
        health: result.health,
        charCount: result.stats.charCount,
        emptyPageCount: result.stats.emptyPageCount,
        fileName: file.name,
      },
      sourceMap,
      maxUploadLabel: MAX_UPLOAD_LABEL,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
