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

   任意（区の担当者の「アカウント自己登録」を有効にする場合。両方必要）:
     INVITE_CODE  : Secret。招待コード（例: uki-2026-bousai）。
                    区長会などで配り、漏れた疑いがあればこの値を変えるだけでよい
                    （作成済みアカウントはそのまま使える）
     USERS_KV     : KVバインディング。Storage & Databases → KV で
                    ネームスペースを作成し、Worker の Settings → Bindings で
                    変数名 USERS_KV としてバインドする。
                    自己登録されたアカウントは user:<名前> のキーで保存される
                    （合言葉はPBKDF2でハッシュ化。権限は ZAITAKU_USERS と同じ
                    「担当地区のみ」。削除はKVダッシュボードでキーを消す）
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

/* ---------- 合言葉のハッシュ化（自己登録アカウント用） ---------- */
const bytesToHex = b => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = h => Uint8Array.from((h.match(/../g) || []).map(x => parseInt(x, 16)));

export async function pbkdf2Hex(password, saltHex){
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: 100000 }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

export async function checkAuth(env, name, password){
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
  // 自己登録アカウント（KV。権限は地区担当者と同じ）
  if (env.USERS_KV){
    try {
      const rec = await env.USERS_KV.get("user:" + name, "json");
      if (rec && rec.salt && rec.hash && (await pbkdf2Hex(password, rec.salt)) === rec.hash)
        return { ok: true, scope: { type: "district", districts: Array.isArray(rec.districts) ? rec.districts : [] } };
    } catch (e) {}
  }
  return { ok: false };
}

/* ---------- アカウント自己登録（招待コード方式） ---------- */
export function validateSignup(body){
  if (!body || typeof body !== "object") return { error: "リクエストが不正です" };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  let districts = Array.isArray(body.districts) ? body.districts : [];
  districts = districts.map(d => typeof d === "string" ? d.trim() : "").filter(Boolean);
  if (!code) return { error: "招待コードを入力してください" };
  if (!name) return { error: "名前を入力してください" };
  if (name.length > 30) return { error: "名前は30文字以内にしてください" };
  if (password.length < 6) return { error: "合言葉は6文字以上にしてください" };
  if (password.length > 100) return { error: "合言葉が長すぎます" };
  if (!districts.length) return { error: "担当地区を入力してください" };
  if (districts.length > 3) return { error: "担当地区は3つまでです" };
  if (districts.some(d => d.length > 40)) return { error: "地区名が長すぎます" };
  // 「豊野町」のように町名だけの指定はその町全体を担当できてしまうため、
  // 自己登録では認めない（町の統括担当者は運営が ZAITAKU_USERS で作る）
  if (districts.some(d => !d.includes(" ")))
    return { error: "担当地区は町名と区名を選んでください" };
  return { code, name, password, districts };
}

async function handleSignup(env, body, cors){
  const v = validateSignup(body);
  if (v.error) return json({ error: v.error }, 400, cors);
  if (!env.INVITE_CODE)
    return json({ error: "アカウント作成は現在利用できません（招待コードが未設定です）。運営にご連絡ください" }, 500, cors);
  if (!env.USERS_KV)
    return json({ error: "アカウント作成は現在利用できません（保存領域が未設定です）。運営にご連絡ください" }, 500, cors);
  if (v.code !== env.INVITE_CODE){
    await new Promise(r => setTimeout(r, 800));   // 総当たり対策の遅延
    return json({ error: "招待コードが違います。運営から伝えられたコードを確認してください" }, 403, cors);
  }
  // 名前の重複チェック（運営アカウント・地区担当者・自己登録すべてと照合）
  let admins = {}, zaitaku = {};
  try { admins = JSON.parse(env.ADMIN_USERS || "{}"); } catch (e) {}
  try { zaitaku = JSON.parse(env.ZAITAKU_USERS || "{}"); } catch (e) {}
  if (admins[v.name] || zaitaku[v.name] || await env.USERS_KV.get("user:" + v.name))
    return json({ error: "その名前は既に使われています。別の名前にしてください（例: 地区名＋名字）" }, 409, cors);
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await pbkdf2Hex(v.password, salt);
  await env.USERS_KV.put("user:" + v.name, JSON.stringify({
    hash, salt, districts: v.districts, created_at: new Date().toISOString(),
  }));
  return json({ ok: true, name: v.name, scope: { type: "district", districts: v.districts } }, 200, cors);
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
/* 町の統括担当者として指定できる町名。ここに無い文字列は前方一致せず、
   完全一致した区だけの担当になる（緩い前方一致が生まれないようにする） */
export const TOWNS = ["三角町", "不知火町", "松橋町", "小川町", "豊野町"];

/* 担当範囲の判定。
     「豊野町 下安見」のように区まで指定 → その区だけ
     「豊野町」のように町名だけ指定     → その町のすべての区（町の統括担当者）
   町名だけの指定は運営が ZAITAKU_USERS で作る場合のみ（自己登録では不可）。 */
export function districtInScope(allowed, name){
  return (allowed || []).some(a =>
    a && (a === name || (TOWNS.includes(a) && String(name).startsWith(a + " "))));
}

export function zaitakuScopeError(oldData, newData, allowed){
  // 担当地区を書かずに登録したアカウントは、在宅避難のデータを全部編集できる
  // （運営が ZAITAKU_USERS で明示的に作った場合のみ。自己登録では担当地区が必須）
  if (!allowed || !allowed.length) return null;
  const inScope = name => districtInScope(allowed, name);
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

    const path = new URL(request.url).pathname;

    // アカウント自己登録（認証前に処理する）
    if (path === "/signup") return handleSignup(env, body, cors);

    const auth = await checkAuth(env, body.name, body.password);
    if (auth.error) return json({ error: auth.error }, 500, cors);
    if (!auth.ok){
      await new Promise(r => setTimeout(r, 800));   // 合言葉の総当たり対策の遅延
      return json({ error: "名前または合言葉が違います" }, 401, cors);
    }

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
