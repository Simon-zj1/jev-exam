import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * 安全响应头。此前一个都没有——点击劫持、MIME 嗅探、Referer 泄漏都是裸奔状态。
   *
   * CSP 里保留 'unsafe-inline' 是必须的：Next 的水合引导脚本与首屏防闪白脚本
   * 都是内联的，去掉会直接白屏。真正收紧要靠 nonce，那是下一步的事，
   * 但 frame-ancestors / base-uri / object-src 这几条现在就能生效。
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  // pdfjs 与 mammoth 都带 Node 专用资源（wasm / 标准字体 / CJS），
  // 交给 Node 直接 require，避免被 webpack 打包后找不到运行时文件。
  serverExternalPackages: ["postgres", "pdfjs-dist", "mammoth"],
  // profile 是用 require.resolve 在运行时拼出来的路径，静态追踪可能漏掉，
  // 显式声明让这些资源随 extract 函数一起上传（否则线上会丢字形与部分解码器）。
  outputFileTracingIncludes: {
    "/api/materials/extract": [
      // pdfjs 在运行时用动态 import 找 worker，静态追踪看不到这个引用；
      // 少一个文件就是线上 400（本地开发不会复现，因为本地 node_modules 是完整的）。
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/wasm/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
    ],
  },
};

export default nextConfig;
