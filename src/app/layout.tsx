import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_NAME} · 上传材料即可自助考试`,
  description: APP_TAGLINE,
  applicationName: APP_NAME,
  // 添加到 iOS 主屏后以独立窗口打开，而不是塞进 Safari 的书签栏
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

export const viewport = {
  themeColor: "#2f5bff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Next 只输出新标准名 mobile-web-app-capable；旧版 iOS 认的是 apple- 前缀 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* 在首屏绘制前应用主题，避免深色模式闪白 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('jev-exam-theme')==='dark'){document.documentElement.dataset.theme='dark'}}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
