/* ============================================================
   オフライン対応（Service Worker）
   一度開いたページとデータをキャッシュし、圏外でも
   最後に取得した状態を表示できるようにする。
   ============================================================ */
"use strict";

const VERSION = "v39";
const APP_CACHE = "app-" + VERSION;
const TILE_CACHE = "tiles-" + VERSION;
const TILE_MAX = 300;   // 地図タイルの最大キャッシュ枚数

const APP_ASSETS = [
  "./",
  "index.html",
  "recruit.html",
  "seikatsu.html",
  "zaitaku.html",
  "zaitaku-admin.html",
  "zaitaku-calc.js",
  "zaitaku-icons.js",
  "home-add.js",
  "manifest.json",
  "manifest-zaitaku.json",
  "manifest-nyuryoku.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/zaitaku-192.png",
  "icons/zaitaku-512.png",
  "icons/zaitaku-apple.png",
  "icons/nyuryoku-192.png",
  "icons/nyuryoku-512.png",
  "icons/nyuryoku-apple.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // 1つ失敗しても他はキャッシュされるよう個別に追加
    await Promise.all(APP_ASSETS.map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()){
      if (key !== APP_CACHE && key !== TILE_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// データ・ページ: ネット優先（常に最新を取りに行き、成功したら控えを保存。圏外なら控えを返す）
async function networkFirst(req, cacheKey){
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(cacheKey, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    throw err;
  }
}

// ライブラリ: キャッシュ優先＋裏で更新（毎回取り直す必要がないもの向け）
async function staleWhileRevalidate(req, cacheKey){
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(cacheKey || req);
  const refresh = fetch(req).then(res => {
    if (res.ok) cache.put(cacheKey || req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

// 地図タイル: キャッシュ優先。枚数が増えすぎたら古いものから削除
async function tileCacheFirst(req){
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok){
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    if (keys.length > TILE_MAX) await cache.delete(keys[0]);
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;   // 保存(POST)には一切関与しない
  const url = new URL(req.url);

  // データ本体（クエリ付きで取得されるためパスで判定）
  if (url.origin === location.origin && url.pathname.endsWith("/data.json")){
    e.respondWith(networkFirst(req, "data.json"));
    return;
  }
  if (url.origin === location.origin && url.pathname.endsWith("/seikatsu.json")){
    e.respondWith(networkFirst(req, "seikatsu.json"));
    return;
  }
  if (url.origin === location.origin && url.pathname.endsWith("/zaitaku.json")){
    e.respondWith(networkFirst(req, "zaitaku.json"));
    return;
  }
  if (url.origin === location.origin && url.pathname.endsWith("/zaitaku-demo.json")){
    e.respondWith(networkFirst(req, "zaitaku-demo.json"));
    return;
  }
  // 地図タイル
  if (url.hostname === "cyberjapandata.gsi.go.jp"){
    e.respondWith(tileCacheFirst(req));
    return;
  }
  // ページ遷移: ネット優先。更新が頻繁なので、開いたときは必ず最新を取りに行く。
  // 圏外のときだけキャッシュ済みのページを返す。
  // 一覧にないパス（管理用ページなど）は素通しする。取り違えて別ページを返さないため。
  if (req.mode === "navigate"){
    const p = url.pathname;
    const page = p.endsWith("/recruit.html") ? "recruit.html"
      : p.endsWith("/seikatsu.html") ? "seikatsu.html"
      : p.endsWith("/zaitaku.html") ? "zaitaku.html"
      : p.endsWith("/zaitaku-admin.html") ? "zaitaku-admin.html"
      : (p.endsWith("/") || p.endsWith("/index.html")) ? "index.html"
      : null;
    if (page){ e.respondWith(networkFirst(req, page)); return; }
    return;
  }
  // 地図ライブラリ（unpkg）と同一オリジンの静的ファイル
  if (url.hostname === "unpkg.com" || url.origin === location.origin){
    e.respondWith(staleWhileRevalidate(req));
  }
});
