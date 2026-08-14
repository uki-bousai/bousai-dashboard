/* ============================================================
   物資のアイコン（共有）

   zaitaku.html（公開ページ）と zaitaku-admin.html（入力画面）の
   両方から読み込む。品目名の横に小さな絵を出して、
   ぱっと見で何の物資か分かるようにするためのもの。

   絵柄は線画1色。色は CSS の color を継いで描く（currentColor）ので、
   ダークモードでもそのまま使える。
   一覧にないID（あとから追加した品目）は段ボール箱の絵になる。
   ============================================================ */
"use strict";

const ZICON = (() => {

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* 小さく表示しても分かるよう、線は太く・形は単純に。
     塗りつぶしは fill-opacity で薄く敷くだけにする */
  const SHAPES = {

    /* 飲料水 ─ ペットボトル */
    water: `
      <rect x="41" y="8" width="18" height="10" rx="3" fill="currentColor" stroke="none"/>
      <path d="M42 18v6c0 6-11 8-11 18v40a6 6 0 0 0 6 6h26a6 6 0 0 0 6-6V42c0-10-11-12-11-18v-6z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M31 56h38"/>`,

    /* パックご飯 ─ ふた付きの容器 */
    rice_pack: `
      <path d="M20 38h60l-6 42a8 8 0 0 1-8 7H34a8 8 0 0 1-8-7z"
            fill="currentColor" fill-opacity=".16"/>
      <rect x="12" y="24" width="76" height="14" rx="5" fill="currentColor" stroke="none"/>`,

    /* レトルト食品 ─ 上をシールしたパウチ */
    retort: `
      <path d="M26 32h48v40c0 10-6 16-16 16H42c-10 0-16-6-16-16z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M22 12h52l-9 10 9 10H22z" fill="currentColor" stroke="none"/>
      <path d="M40 54h20M40 70h13"/>`,

    /* お茶 ─ 湯気の立つ湯のみ */
    tea: `
      <path d="M40 30c-5-6 0-9 0-15M58 30c-5-6 0-9 0-15"/>
      <path d="M22 42h56v14c0 16-12 28-28 28S22 72 22 56z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M16 90h68"/>`,

    /* スポーツドリンク ─ 角ばったボトル */
    sports_drink: `
      <rect x="38" y="8" width="24" height="11" rx="3" fill="currentColor" stroke="none"/>
      <path d="M24 34a10 10 0 0 1 6-9l6-6h28l6 6a10 10 0 0 1 6 9v50a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M24 46h52M24 70h52"/>`,

    /* 野菜ジュース ─ 紙パックとストロー */
    veg_juice: `
      <path d="M28 36h44v52a5 5 0 0 1-5 5H33a5 5 0 0 1-5-5z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M28 36l22-20 22 20"/>
      <path d="M64 28l10-16"/>`,

    /* サプリメント ─ カプセルと錠剤 */
    supplement: `
      <path d="M18 62a16 16 0 0 1 0-23l14-14a16 16 0 0 1 23 23L41 62a16 16 0 0 1-23 0z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M26 31l23 23"/>
      <circle cx="70" cy="70" r="18" fill="currentColor" fill-opacity=".16"/>
      <path d="M57 70h26"/>`,

    /* お菓子 ─ クッキー */
    snack: `
      <circle cx="50" cy="52" r="34" fill="currentColor" fill-opacity=".16"/>
      <circle cx="38" cy="41" r="5" fill="currentColor" stroke="none"/>
      <circle cx="62" cy="46" r="5" fill="currentColor" stroke="none"/>
      <circle cx="49" cy="65" r="5" fill="currentColor" stroke="none"/>`,

    /* トイレットペーパー ─ ロールと垂れた紙 */
    toilet_paper: `
      <rect x="16" y="24" width="52" height="52" rx="12"
            fill="currentColor" fill-opacity=".16"/>
      <circle cx="42" cy="50" r="12"/>
      <path d="M68 36v52h14V44"/>`,

    /* お尻拭き ─ ふた付きのパック */
    baby_wipes: `
      <rect x="10" y="34" width="80" height="46" rx="16"
            fill="currentColor" fill-opacity=".16"/>
      <ellipse cx="50" cy="52" rx="22" ry="11"/>
      <path d="M41 52h18"/>`,

    /* 身体を拭くシート ─ 袋から1枚出ている */
    body_wipes: `
      <path d="M20 48h60v32a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M35 48l3-33 12 12 9-17 7 38z"/>
      <path d="M32 70h30"/>`,

    /* 子ども用紙おむつ ─ はいた形（腰まわりと足ぐり） */
    diaper_child: `
      <rect x="16" y="20" width="68" height="13" rx="5" fill="currentColor" stroke="none"/>
      <path d="M16 33h68v11c0 11-8 17-12 25l-3 7H51c0-13-1-19-1-19s-1 6-1 19H31l-3-7c-4-8-12-14-12-25z"
            fill="currentColor" fill-opacity=".16"/>`,

    /* 大人用紙おむつ ─ 同じ形に腰のテープを足して区別する */
    diaper_adult: `
      <rect x="4" y="21" width="16" height="11" rx="4" fill="currentColor" stroke="none"/>
      <rect x="80" y="21" width="16" height="11" rx="4" fill="currentColor" stroke="none"/>
      <rect x="20" y="20" width="60" height="13" rx="5" fill="currentColor" stroke="none"/>
      <path d="M20 33h60v11c0 11-7 17-11 25l-3 7H51c0-13-1-19-1-19s-1 6-1 19H34l-3-7c-4-8-11-14-11-25z"
            fill="currentColor" fill-opacity=".16"/>`,

    /* ミルク ─ 哺乳瓶 */
    milk: `
      <path d="M41 22c0-9 3-14 9-14s9 5 9 14"/>
      <rect x="35" y="22" width="30" height="11" rx="4" fill="currentColor" stroke="none"/>
      <path d="M34 33h32v49a8 8 0 0 1-8 8H42a8 8 0 0 1-8-8z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M42 50h12M42 66h12"/>`,
  };

  /* 一覧にない品目（あとから追加されたもの）は段ボール箱で表す */
  const FALLBACK = `
      <path d="M14 36h72v48a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z"
            fill="currentColor" fill-opacity=".16"/>
      <path d="M14 36l12-18h48l12 18"/>
      <path d="M50 36v56"/>`;

  function shapes(id){
    return Object.prototype.hasOwnProperty.call(SHAPES, id) ? SHAPES[id] : FALLBACK;
  }

  /* 品目IDから <svg> を作って返す。中身は定数なので innerHTML で問題ない */
  function svg(id, extraClass){
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 100 100");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "7");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    s.setAttribute("class", "zic" + (extraClass ? " " + extraClass : ""));
    s.innerHTML = shapes(id);
    return s;
  }

  function has(id){ return Object.prototype.hasOwnProperty.call(SHAPES, id); }

  return { svg, has, ids: () => Object.keys(SHAPES) };
})();

/* Node.js からのテスト用（ブラウザでは何もしない） */
if (typeof module !== "undefined" && module.exports) module.exports = ZICON;
