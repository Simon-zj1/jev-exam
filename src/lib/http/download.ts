/**
 * 生成「浏览器直接下载」的响应。
 *
 * 文件名可能是中文，必须同时给 ASCII 兜底与 RFC 5987 的 filename*，
 * 否则不同浏览器会存成乱码名或干脆忽略文件名。
 */
export function downloadResponse(options: {
  content: string;
  asciiName: string;
  fileName: string;
  contentType: string;
}): Response {
  const encoded = encodeURIComponent(options.fileName);
  return new Response(options.content, {
    headers: {
      "Content-Type": `${options.contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${options.asciiName}"; filename*=UTF-8''${encoded}`,
      // 导出内容含个人信息，禁止任何中间层缓存
      "Cache-Control": "no-store",
    },
  });
}

export function stamp(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}
