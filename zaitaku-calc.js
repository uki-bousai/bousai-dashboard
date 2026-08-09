/* ============================================================
   在宅避難者 物資計算ロジック（共有）

   zaitaku-admin.html（入力画面）と zaitaku.html（公開集計ページ）の
   両方から読み込んで使う。

   考え方:
     在宅避難の世帯は、いまの在庫（残量）を正確に確認できない。
     だから入力は「世帯人数」と「必要な物資はどれか」だけ。
     数量はここで計算する:
       3日分持つのに必要な量 = 1人1日あたり × 対象人数 × 目標日数

   計算基準（1人1日あたりの量・目標日数）は zaitaku.json の
   rules / settings に持ち、入力画面から変更できる。
   ============================================================ */
"use strict";

const ZCALC = (() => {

  const DEFAULT_SETTINGS = { buffer_days: 3 };

  function setting(settings, key){
    const v = settings ? Number(settings[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SETTINGS[key];
  }

  /* 対象人数の解決:
       all    → 世帯人数
       infant → 乳幼児の人数, elderly → 高齢者の人数 など
     内訳が未入力の世帯でも、その品目が「必要」と報告されていれば
     「対象者が1人いる」とみなして計算する（報告=対象者がいる、という扱い）。 */
  const TARGET_FIELD = { adult: "adults", child: "children", infant: "infants", elderly: "elderly" };
  const TARGET_LABEL = { all: "全員", adult: "大人", child: "子ども", infant: "乳幼児", elderly: "高齢者" };

  function targetCount(rule, hh, needExists){
    if (!rule.target || rule.target === "all") return Number(hh.size) || 0;
    const raw = hh[TARGET_FIELD[rule.target]];
    if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw)))
      return Math.max(0, Number(raw));
    return needExists ? 1 : 0;
  }

  /* 1世帯×1品目の計算。
     「必要」と報告されていない品目、対象外（乳幼児0人など）は null */
  function calcItem(rule, hh, settings){
    if (rule.is_active === false) return null;
    const entry = (hh.needs || {})[rule.id];
    if (!entry) return null;
    const tc = targetCount(rule, hh, true);
    const daily = (Number(rule.daily_amount_per_person) || 0) * tc;
    if (daily <= 0) return null;
    const buffer = Number(rule.buffer_days) > 0 ? Number(rule.buffer_days) : setting(settings, "buffer_days");
    return {
      rule, targetCount: tc, daily, buffer,
      need: daily * buffer,                 // 目標日数分持つのに必要な量
      note: entry && entry.note ? String(entry.note) : "",
    };
  }

  function calcHousehold(hh, rules, settings){
    return (rules || []).map(r => calcItem(r, hh, settings)).filter(Boolean);
  }

  /* 地区別集計（公開ページは地区単位のみ表示。個人は出さない） */
  function aggregate(households, rules, settings){
    const map = {};
    (households || []).forEach(hh => {
      const d = (hh.district || "").trim() || "地区未設定";
      const g = map[d] || (map[d] = { district: d, households: 0, people: 0, items: {} });
      g.households++;
      g.people += Number(hh.size) || 0;
      calcHousehold(hh, rules, settings).forEach(c => {
        const it = g.items[c.rule.id] || (g.items[c.rule.id] = {
          rule: c.rule, households: 0, people: 0, need: 0, buffer: c.buffer, notes: [],
        });
        it.households++;
        it.people += c.targetCount;
        it.need += c.need;
        if (c.note) it.notes.push(c.note);
      });
    });
    Object.values(map).forEach(g => {
      g.itemList = Object.values(g.items)
        .sort((a, b) => b.households - a.households || b.people - a.people);
      g.needCount = g.itemList.reduce((a, it) => a + it.households, 0);
    });
    // 必要件数が多い地区から並べる
    return Object.values(map).sort((a, b) =>
      b.needCount - a.needCount || a.district.localeCompare(b.district, "ja"));
  }

  /* 全体サマリー（件数は 世帯×品目 の数え方） */
  function summary(households, rules, settings){
    const s = { households: 0, people: 0, needCount: 0, items: {} };
    (households || []).forEach(hh => {
      s.households++;
      s.people += Number(hh.size) || 0;
      calcHousehold(hh, rules, settings).forEach(c => {
        s.needCount++;
        const r = s.items[c.rule.id] || (s.items[c.rule.id] = {
          rule: c.rule, households: 0, people: 0, need: 0, buffer: c.buffer,
        });
        r.households++;
        r.people += c.targetCount;
        r.need += c.need;
      });
    });
    s.itemList = Object.values(s.items)
      .sort((a, b) => b.households - a.households || b.people - a.people);
    return s;
  }

  /* ---------- 表示用フォーマット ---------- */

  function fmtQty(v, unit){
    if (!Number.isFinite(v) || v <= 0) return "0" + (unit || "");
    if (unit === "ml"){
      if (v >= 1000) return (Math.ceil(v / 100) / 10).toFixed(1) + "L";
      return Math.ceil(v) + "ml";
    }
    const n = Math.ceil(v * 10) / 10;
    return (Number.isInteger(n) ? String(n) : n.toFixed(1)) + (unit || "");
  }

  /* 「24L（2Lペットボトル 約12本）」のように、なじみのある単位でも補足する */
  function fmtQtyWithPack(rule, v){
    const base = fmtQty(v, rule.unit);
    if (!Number.isFinite(v) || v <= 0) return base;
    const packs = (rule.packs || []).filter(p => Number(p.factor) > 1 && p.unit && p.unit !== rule.unit);
    if (!packs.length) return base;
    const p = packs.reduce((a, b) => (Number(b.factor) > Number(a.factor) ? b : a));
    return `${base}（${p.label} 約${Math.ceil(v / Number(p.factor))}${p.unit}）`;
  }

  function targetLabel(rule){ return TARGET_LABEL[rule.target || "all"] || "全員"; }

  return {
    DEFAULT_SETTINGS, setting, targetCount,
    calcItem, calcHousehold, aggregate, summary,
    fmtQty, fmtQtyWithPack, targetLabel,
  };
})();

/* Node.js からのテスト用（ブラウザでは何もしない） */
if (typeof module !== "undefined" && module.exports) module.exports = ZCALC;
