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
                    → すべてのファイルを保存できる（運営スタッフ用）

   任意の Secret（在宅避難者アプリの地区担当者を追加する場合）:
     ZAITAKU_USERS: 地区担当者の一覧。JSON文字列で
                    {"名前": {"password":"合言葉", "districts":["松橋町 豊福"]}, ...}
                    例: {"山田":{"password":"tofu-3-yama","districts":["松橋町 豊福"]},
                         "鈴木":{"password":"kugu-8-kawa","districts":["松橋町 久具","松橋町 豊福"]}}
                    → zaitaku.json のみ保存可。しかも districts に書いた
                      地区の世帯と集積場所だけ変更できる（他地区・計算基準・
                      設定を変えようとするとサーバー側で拒否される）
   ============================================================ */

const OWNER  = "uki-bousai";
const REPO   = "bousai-dashboard";
const BRANCH = "main";
// 保存を許可するファイル（先頭が既定値。リクエストの path で切り替え可能）
const PATHS  = ["data.json", "seikatsu.json", "zaitaku.json", "zaitaku-demo.json"];
// 在宅避難者アプリのデータ（zaitaku-demo.json は ?env=demo の検証環境用。仕組み・権限は本番と同じ）
const ZAITAKU_PATHS = ["zaitaku.json", "zaitaku-demo.json"];
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
  let admins, zaitaku;
  try { admins = JSON.parse(env.ADMIN_USERS || "{}"); }
  catch { return { error: "サーバー設定エラー: ADMIN_USERS が正しいJSONではありません" }; }
  try { zaitaku = JSON.parse(env.ZAITAKU_USERS || "{}"); }
  catch { return { error: "サーバー設定エラー: ZAITAKU_USERS が正しいJSONではありません" }; }
  if (typeof name !== "string" || typeof password !== "string" || !name || !password)
    return { ok: false };
  const expected = admins[name];
  if (typeof expected === "string" && expected.length > 0 && expected === password)
    return { ok: true, scope: { type: "admin" } };
  // 地区担当者（在宅避難者アプリのみ・担当地区のみ）
  const z = zaitaku[name];
  if (z && typeof z.password === "string" && z.password.length > 0 && z.password === password)
    return { ok: true, scope: { type: "district", districts: Array.isArray(z.districts) ? z.districts : [] } };
  return { ok: false };
}

/* キー順に依存しない比較用の文字列化 */
function stable(v){
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

/* 地区担当者の保存内容チェック。
   担当地区（allowed）の世帯・集積場所だけ変更でき、計算基準・設定・
   他地区のデータに差分があればエラー文字列を返す。 */
export function zaitakuScopeError(oldData, newData, allowed){
  const inScope = name => allowed.includes(name);
  if (stable(oldData.rules) !== stable(newData.rules))
    return "計算基準は運営スタッフのみ変更できます";
  if (stable(oldData.settings) !== stable(newData.settings))
    return "設定は運営スタッフのみ変更できます";
  const oldD = new Map((oldData.districts || []).map(d => [d.name, d]));
  const newD = new Map((newData.districts || []).map(d => [d.name, d]));
  for (const [name, d] of oldD){
    if (inScope(name)) continue;
    const nd = newD.get(name);
    if (!nd || stable(nd) !== stable(d)) return `担当外の地区「${name}」は変更できません`;
  }
  for (const name of newD.keys()){
    if (!oldD.has(name) && !inScope(name)) return `担当外の地区「${name}」は追加できません`;
  }
  const oldH = new Map((oldData.households || []).map(h => [h.id, h]));
  const newH = new Map((newData.households || []).map(h => [h.id, h]));
  for (const [id, h] of oldH){
    if (inScope(h.district)) continue;
    const nh = newH.get(id);
    if (!nh || stable(nh) !== stable(h)) return `担当外の地区「${h.district}」の世帯は変更できません`;
  }
  for (const [id, h] of newH){
    if (oldH.has(id)){
      if (inScope(oldH.get(id).district) && !inScope(h.district))
        return `担当外の地区「${h.district}」へは変更できません`;
    } else if (!inScope(h.district)){
      return `担当外の地区「${h.district}」の世帯は登録できません`;
    }
  }
  return null;
}

function ghHeaders(env){
  return {
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bousai-dashboard-worker",
  };
}

async function latestFile(env, filePath){
  const res = await fetch(`${apiFor(filePath)}?ref=${BRANCH}`, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error("GitHubからの読み込みに失敗しました（HTTP " + res.status + "）。GITHUB_TOKEN の権限・有効期限を確認してください");
  const body = await res.json();
  let content = null;
  try {
    const bin = atob((body.content || "").replace(/\n/g, ""));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    content = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {}
  return { sha: body.sha, content };
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

    // ログイン確認のみ（データは変更しない）。担当範囲も返す
    if (path === "/auth") return json({ ok: true, name: body.name, scope: auth.scope }, 200, cors);

    // データ保存（GitHubへコミット）
    if (path === "/save"){
      const filePath = PATHS.includes(body.path) ? body.path : PATHS[0];
      // 地区担当者は在宅避難者データ（本番・検証）のみ保存できる
      if (auth.scope.type === "district" && !ZAITAKU_PATHS.includes(filePath))
        return json({ error: "このデータの保存権限がありません" }, 403, cors);
      const data = body.data;
      const valid = filePath === "seikatsu.json"
        ? (data && typeof data === "object" && Array.isArray(data.water) && Array.isArray(data.toilets) && Array.isArray(data.haves))
        : ZAITAKU_PATHS.includes(filePath)
        ? (data && typeof data === "object" && Array.isArray(data.households) && Array.isArray(data.rules) &&
           data.settings && typeof data.settings === "object")
        : (data && typeof data === "object" && Array.isArray(data.shelters) && Array.isArray(data.supplies));
      if (!valid) return json({ error: "データの形式が不正です" }, 400, cors);
      const text = JSON.stringify(data, null, 2) + "\n";
      if (text.length > 1000000) return json({ error: "データが大きすぎます" }, 400, cors);
      const prefix = filePath === "seikatsu.json" ? "生活情報更新"
        : filePath === "zaitaku.json" ? "在宅避難者情報更新"
        : filePath === "zaitaku-demo.json" ? "在宅避難者情報更新（検証）" : "状況更新";
      const message = `${prefix} ${data.updatedAt || ""}（更新者: ${body.name}）`;
      try {
        let cur = await latestFile(env, filePath);
        // 地区担当者は担当地区の世帯・集積場所だけ変更できる（サーバー側で強制）
        if (auth.scope.type === "district"){
          if (!cur.content) return json({ error: "現在の公開データを確認できないため保存できません。時間をおいて再度お試しください" }, 502, cors);
          const scopeErr = zaitakuScopeError(cur.content, data, auth.scope.districts || []);
          if (scopeErr) return json({ error: scopeErr }, 403, cors);
        }
        let res = await putFile(env, filePath, text, message, cur.sha);
        if (res.status === 409 || res.status === 422){
          // 競合時は1回だけ再試行（担当範囲チェックも最新内容でやり直す）
          cur = await latestFile(env, filePath);
          if (auth.scope.type === "district"){
            if (!cur.content) return json({ error: "現在の公開データを確認できないため保存できません。時間をおいて再度お試しください" }, 502, cors);
            const scopeErr = zaitakuScopeError(cur.content, data, auth.scope.districts || []);
            if (scopeErr) return json({ error: scopeErr }, 403, cors);
          }
          res = await putFile(env, filePath, text, message, cur.sha);
        }
        if (!res.ok) return json({ error: "GitHubへの保存に失敗しました（HTTP " + res.status + "）" }, 502, cors);
        return json({ ok: true }, 200, cors);
      } catch (e) {
        return json({ error: e.message }, 502, cors);
      }
    }

    return json({ error: "not found" }, 404, cors);
  }
};
