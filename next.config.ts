import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
