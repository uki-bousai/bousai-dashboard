/* ============================================================
   防災ダッシュボード 中継サーバー（Cloudflare Worker）

   管理者画面から送られた「名前 + 合言葉」を確認し、正しければ
   GitHub の data.json を代理で更新します。GitHub のトークンは
   この Worker の Secret にだけ保管され、管理者には配りません。

   セットアップ手順は MANUAL.md の「中継サーバーの初期設定」を参照。

   必要な Secret（Workers の Settings → Variables and Secrets）:
     GITHUB_TOKEN : Fine-grained PAT
                    （bousai-dashboard のみ / Contents: Read and write）
     ADMIN_USERS  : 管理者の一覧。JSON文字列で {"名前":"合言葉", ...}
                    例: {"田中":"aki-2026-yama","佐藤":"kawa-9-hoshi"}
   ============================================================ */

const OWNER  = "uki-bousai";
const REPO   = "bousai-dashboard";
const BRANCH = "main";
// 保存を許可するファイル（先頭が既定値。リクエストの path で切り替え可能）
const PATHS  = ["data.json", "seikatsu.json"];
const ALLOWED_ORIGINS = [
  "https://uki-bousai.github.io",
];

const apiFor = p => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(p)}`;

function corsHeaders(origin){
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });

function b64encode(str){
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function checkAuth(env, name, password){
  let users;
  try { users = JSON.parse(env.ADMIN_USERS || "{}"); }
  catch { return { error: "サーバー設定エラー: ADMIN_USERS が正しいJSONではありません" }; }
  if (typeof name !== "string" || typeof password !== "string" || !name || !password)
    return { ok: false };
  const expected = users[name];
  return { ok: typeof expected === "string" && expected.length > 0 && expected === password };
}

function ghHeaders(env){
  return {
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bousai-dashboard-worker",
  };
}

async function latestSha(env, filePath){
  const res = await fetch(`${apiFor(filePath)}?ref=${BRANCH}`, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error("GitHubからの読み込みに失敗しました（HTTP " + res.status + "）。GITHUB_TOKEN の権限・有効期限を確認してください");
  return (await res.json()).sha;
}

function putFile(env, filePath, body, message, sha){
  return fetch(apiFor(filePath), {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: b64encode(body), branch: BRANCH, sha }),
  });
}

export default {
  async fetch(request, env){
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "リクエストが不正です" }, 400, cors); }

    const auth = checkAuth(env, body.name, body.password);
    if (auth.error) return json({ error: auth.error }, 500, cors);
    if (!auth.ok){
      await new Promise(r => setTimeout(r, 800));   // 合言葉の総当たり対策の遅延
      return json({ error: "名前または合言葉が違います" }, 401, cors);
    }

    const path = new URL(request.url).pathname;

    // ログイン確認のみ（データは変更しない）
    if (path === "/auth") return json({ ok: true, name: body.name }, 200, cors);

    // データ保存（GitHubへコミット）
    if (path === "/save"){
      const filePath = PATHS.includes(body.path) ? body.path : PATHS[0];
      const data = body.data;
      const valid = filePath === "seikatsu.json"
        ? (data && typeof data === "object" && Array.isArray(data.water) && Array.isArray(data.toilets) && Array.isArray(data.haves))
        : (data && typeof data === "object" && Array.isArray(data.shelters) && Array.isArray(data.supplies));
      if (!valid) return json({ error: "データの形式が不正です" }, 400, cors);
      const text = JSON.stringify(data, null, 2) + "\n";
      if (text.length > 1000000) return json({ error: "データが大きすぎます" }, 400, cors);
      const prefix = filePath === "seikatsu.json" ? "生活情報更新" : "状況更新";
      const message = `${prefix} ${data.updatedAt || ""}（更新者: ${body.name}）`;
      try {
        let res = await putFile(env, filePath, text, message, await latestSha(env, filePath));
        if (res.status === 409 || res.status === 422)
          res = await putFile(env, filePath, text, message, await latestSha(env, filePath));   // 競合時は1回だけ再試行
        if (!res.ok) return json({ error: "GitHubへの保存に失敗しました（HTTP " + res.status + "）" }, 502, cors);
        return json({ ok: true }, 200, cors);
      } catch (e) {
        return json({ error: e.message }, 502, cors);
      }
    }

    return json({ error: "not found" }, 404, cors);
  }
};
