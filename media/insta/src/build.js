"use strict";
/* 8月19日の対策本部会議まとめを、Instagram（4:5・1080x1350）の連続投稿にする。
   本文は seikatsu.json の briefings と同じ内容を、画像で読める長さに詰めたもの。 */
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const DIR = __dirname;
const OUT = path.join(DIR, "out");
const DATE = "2026-08-19";

/* 掲載内容が seikatsu.json とずれていないか確かめるための照合用 */
const brief = JSON.parse(fs.readFileSync("/home/user/bousai-dashboard/seikatsu.json", "utf8"))
  .briefings.find(b => b.date === DATE);
if (!brief) throw new Error(DATE + " の報告が seikatsu.json にありません");

const SLIDES = [
  {
    type: "cover", dark: true,
    tag: "熊本県 宇城市 ／ 令和8年 熊本地震",
    title: "8月19日\n**災害対策本部**\n会議のまとめ",
    cap: "宇城市議会 豊田紀代美議長の報告より。\n第22回の会議で出た話を、9つにまとめました。",
    toc: ["🔧 住宅の応急修理", "🏘 みなし仮設住宅", "💧 上水道の復旧", "🩺 健康支援の訪問",
          "🏛 自治公民館の再建", "🌾 農業・一次産業", "🏅 局地激甚災害", "📊 被害の報告",
          "🟦 ブルーシート"],
  },
  {
    num: "01 ／ 住宅の応急修理制度", icon: "🔧",
    head: "8月20日（木）から\n受付が始まります",
    lines: [
      "日常生活に必要な**最小限度の修理**が対象です",
      "**オンライン受付**が8月20日（木）から始まります",
      "**総合窓口**も同じ日から。場所は市にご確認ください",
      "**各支所**は8月24日の週を目安に開設予定です",
    ],
    note: "⚠ 上限56,400円の「被害の拡大を防ぐ緊急の修理」とは別の制度です。取り違えにご注意ください",
    warn: true,
  },
  {
    num: "02 ／ みなし仮設住宅と住まいの再建", icon: "🏘",
    head: "相談は**376件**に\nなりました",
    lines: [
      "賃貸型応急住宅（みなし仮設住宅）の相談件数です",
      "議長から、**みなし仮設・建設型の仮設・空き家の活用**を組み合わせた対策を要望しました",
      "空き家は、そのまま使える住宅と修理が要る住宅があり、いまは活用が難しい面もあるとの回答でした",
      "**実際の入居数**を早急に把握するよう求めました",
    ],
    note: "今後の需要によっては、建設型の応急仮設住宅を増やす必要も出てきます",
  },
  {
    num: "03 ／ 在宅避難者などへの健康支援", icon: "🩺",
    head: "看護師・保健師の\n訪問が**3,626件**",
    lines: [
      "8月16日時点の訪問件数です",
      "訪問した件数も、**継続的な支援が必要**と判断された方の人数も増えています",
      "今後も健康状態の確認と見守りを続け、二次災害を防ぐとのことです",
    ],
    note: "避難所にいない方こそ、見えにくくなります。周りの方の声かけをお願いします",
  },
  {
    num: "04 ／ 自治公民館・地域コミュニティの再建", icon: "🏛",
    head: "公民館の修理にも\n**支援を要望**",
    lines: [
      "公民館は平常時だけでなく、**災害時に住民が集まり支え合う拠点**です",
      "個人の住宅の再建と合わせて、**地域そのものの再建**にも取り組む必要があると求めました",
      "市長からは、10年前の災害で創設された**災害復興基金**と同じような制度を国・県に強く求めていくとの発言がありました",
    ],
  },
  {
    num: "05 ／ 上水道の復旧状況", icon: "💧",
    head: "小川町でも\n断水が**減っています**",
    lines: [
      "水圧を下げての給水や、水が通せる地域も少しずつ広がっています",
      "**復旧に一定の見通し**が見え始めたと報告がありました",
      "市の職員や県、議員が、夜間も含めて日ごとの計画を立てて作業にあたっています",
    ],
    note: "給水所の場所や時間は、生活支援情報のページで確認できます",
  },
  {
    num: "06 ／ 農業・一次産業", icon: "🌾",
    head: "被害額は\n**約78億円**",
    lines: [
      "農地・農業用施設・漁業を合わせた、現時点での被害額です",
      "議長から、**昨年の豪雨災害に続く被害**であることから、一次産業を守るためのより手厚い支援策を強く要望しました",
    ],
    note: "同じ会議で、局地激甚災害の指定を受けたことも報告されました",
  },
  {
    type: "mini",
    num: "07 ／ そのほかの報告",
    head: "そのほかに\n出た話",
    items: [
      { h: "🏅 局地激甚災害の指定を受けました",
        t: "被災した中小企業や事業者への、国の手厚い支援を受けられる可能性が広がりました" },
      { h: "📊 被害報告は累計 1,256件",
        t: "前の日から16件増。1日あたりの増え方はゆるやかになり、被害の全容が見え始めています" },
      { h: "🟦 ブルーシートの養生支援",
        t: "県と建設業協会の支援を受けながら、作業が着実に進められています" },
    ],
  },
  {
    type: "end", dark: true,
    tag: "毎日、更新しています",
    title: "くわしくは\n**こちら**",
    url: "uki-bousai.github.io/\nbousai-dashboard/seikatsu.html",
    who: "給水・トイレ・入浴・お届けなどの\n生活支援情報をまとめています。\n\n**在宅避難**の方に必要な物資も、\n区ごとに公開しています。",
  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await b.newPage({ viewport: { width: 1160, height: 1420 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.addInitScript(s => { window.__SLIDES__ = s; }, SLIDES);
  await p.goto("file://" + path.join(DIR, "slides.html"), { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const ids = await p.evaluate(() => [...document.querySelectorAll(".s")].map(e => e.id));
  const over = [];
  for (const id of ids) {
    const h = await p.evaluate(i => {
      const e = document.getElementById(i);
      return { scroll: e.scrollHeight, client: e.clientHeight };
    }, id);
    if (h.scroll > 1351) over.push({ id, ...h });
    await p.locator("#" + id).screenshot({ path: path.join(OUT, id + ".png") });
  }
  console.log(JSON.stringify({ count: ids.length, over, errs,
    jsonTopics: brief.topics.length }, null, 1));
  await b.close();
})();
