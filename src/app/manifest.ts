import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

export const dynamic = "force-static";

/** Web App Manifest：让「添加到主屏幕」后是独立窗口，而不是一个书签。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} · 自助备考`,
    short_name: APP_NAME,
    description: `${APP_TAGLINE}。上传 PDF/Word，逐得分点判定，错题按间隔重复排期。`,
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#2f5bff",
    lang: "zh-CN",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
