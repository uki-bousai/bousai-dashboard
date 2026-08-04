/* ============================================================
   オフライン対応（Service Worker）
   一度開いたページとデータをキャッシュし、圏外でも
   最後に取得した状態を表示できるようにする。
   ============================================================ */
"use strict";

const VERSION = "v4";
const APP_CACHE = "app-" + VERSION;
const TILE_CACHE = "tiles-" + VERSION;
const TILE_MAX = 300;   // 地図タイルの最大キャッシュ枚数

const APP_ASSETS = [
  "./",
  "index.html",
  "recruit.html",
  "seikatsu.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
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

// データ: ネット優先（常に最新を取りに行き、成功したら控えを保存。圏外なら控えを返す）
async function networkFirstData(req, cacheKey){
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

// ページ・ライブラリ: キャッシュ優先＋裏で更新（次回開いたとき新しくなる）
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
    e.respondWith(networkFirstData(req, "data.json"));
    return;
  }
  if (url.origin === location.origin && url.pathname.endsWith("/seikatsu.json")){
    e.respondWith(networkFirstData(req, "seikatsu.json"));
    return;
  }
  // 地図タイル
  if (url.hostname === "cyberjapandata.gsi.go.jp"){
    e.respondWith(tileCacheFirst(req));
    return;
  }
  // ページ遷移（オフライン時はキャッシュ済みのページを返す）
  if (req.mode === "navigate"){
    const page = url.pathname.endsWith("/recruit.html") ? "recruit.html"
      : url.pathname.endsWith("/seikatsu.html") ? "seikatsu.html"
      : (url.pathname.endsWith("/admin.html") || url.pathname.endsWith("/seikatsu-admin.html")) ? null   // 入力画面は常に最新を使う
      : "index.html";
    if (page){ e.respondWith(staleWhileRevalidate(req, page)); return; }
    return;
  }
  // 地図ライブラリ（unpkg）と同一オリジンの静的ファイル
  if (url.hostname === "unpkg.com" || url.origin === location.origin){
    e.respondWith(staleWhileRevalidate(req));
  }
});
