/* ============================================================
   「ホーム画面に追加」の案内（共有）

   区長さんや議員さんが毎回ブラウザで検索しなくてすむよう、
   ホーム画面への追加を案内する。

   いちばん多いつまずきは、スレッズ・インスタ・LINE などの
   アプリの中のブラウザで開いていて「ホーム画面に追加」が
   そもそも出てこないこと。そのときは先に Safari で開いてもらう。

   使い方: ページに <div id="homeTip"></div> を置いて、このファイルを読み込む。
   すでにホーム画面から開いている場合は何も表示しない。
   ============================================================ */
"use strict";

(() => {
  const box = document.getElementById("homeTip");
  if (!box) return;

  const ua = navigator.userAgent || "";
  /* アプリ内ブラウザ（スレッズ/インスタ/Facebook/LINE/X など） */
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Threads|Barcelona|Line\/|KAKAOTALK|Twitter/i.test(ua);
  const iOS = /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  /* すでにホーム画面から開いているなら案内は不要 */
  const installed = navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (installed) return;
  if (!iOS && !android) return;   // パソコンでは出さない

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  /* 手順（機種ごとに書き分ける） */
  function steps(){
    const ol = el("ol", "hstep");
    const add = t => ol.appendChild(el("li", "", t));
    if (iOS){
      add("画面の下（または上）にある 共有ボタン（□に↑の絵）を押す");
      add("メニューを下にたどって「ホーム画面に追加」を押す");
      add("右上の「追加」を押す");
    } else {
      add("画面右上の「⋮」を押す");
      add("「ホーム画面に追加」または「アプリをインストール」を押す");
      add("「追加」を押す");
    }
    return ol;
  }

  const wrap = el("div", "hometip");

  if (inApp){
    /* アプリの中のブラウザ: まず本来のブラウザで開いてもらう */
    wrap.classList.add("warn");
    wrap.appendChild(el("div", "hhead",
      "⚠️ いまアプリの中のブラウザで開いています"));
    const p = el("div", "htext");
    p.textContent = iOS
      ? "このままではホーム画面に追加できません。画面の右上か右下にある「…」や矢印のボタンから「Safariで開く」を選んでください。"
      : "このままではホーム画面に追加できません。画面右上の「⋮」から「ブラウザで開く」（Chromeなど）を選んでください。";
    wrap.appendChild(p);
    const d = el("details", "hmore");
    d.appendChild(el("summary", "", "ブラウザで開いたあとの手順"));
    d.appendChild(steps());
    wrap.appendChild(d);
  } else {
    /* ふつうのブラウザ: 折りたたみで控えめに案内する */
    const d = el("details", "hometip-d");
    d.appendChild(el("summary", "", "📱 ホーム画面に追加すると、次から1タップで開けます"));
    const p = el("div", "htext");
    p.textContent = iOS
      ? "毎回さがさなくてすみます。追加してもスマホの容量はほとんど使いません。"
      : "毎回さがさなくてすみます。アプリのように使えます。";
    d.appendChild(p);
    d.appendChild(steps());
    wrap.appendChild(d);
  }

  box.appendChild(wrap);
})();
