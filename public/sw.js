/**
 * Service Worker：只缓存「静态外壳」，不缓存任何业务页面。
 *
 * 为什么不做「离线可读材料」：所有页面都是按登录用户服务端渲染的，
 * 把带个人数据的 HTML 缓存进 Cache Storage，在同一台设备上换账号就会串数据。
 * 所以这里只做两件事：
 *   1. 静态资源（/_next/static/**、图标）走缓存优先，回访更快；
 *   2. 导航请求失败时回落到 /offline，把「哪些能用、哪些要联网」讲清楚。
 */
const CACHE = "jev-exam-static-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icon.svg", "/apple-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/apple-icon.png" ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 接口一律直连网络：缓存 API 响应既无意义也不安全
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // 导航请求：网络优先，失败才回落到离线说明页（绝不缓存正文）
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
