"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker。
 *
 * 只在生产构建里注册：开发模式下 SW 会缓存住 HMR 的资源，出现「改了代码页面没变」这类难查的问题。
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 注册失败不影响主流程：离线兜底本来就是增强项
      });
    };

    // 等首屏空闲再注册，避免和关键资源抢带宽
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
