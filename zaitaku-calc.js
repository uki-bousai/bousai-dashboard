/* ============================================================
   在宅避難者 物資計算ロジック（共有）

   zaitaku-admin.html（入力画面）と zaitaku.html（公開集計ページ）の
   両方から読み込んで使う。

   考え方:
     世帯ごとの登録は現場の負担が大きく、人数の把握も難しい。
     だから登録は「区ごとに1件」: 在宅避難の世帯数と、必要な物資だけ。
     数量はここで概算する:
       3日分の数量 = 1人1日あたり × 世帯数 × 1世帯あたり平均人数 × 目標日数
     おむつ・ミルクなど対象が限られる品目は、地区の乳幼児・高齢者の
     人数（任意入力）があればそれで計算する。

   計算基準（1人1日あたりの量・平均人数・目標日数）は zaitaku.json の
   rules / settings に持ち、入力画面から変更できる。
   ============================================================ */
"use strict";

const ZCALC = (() => {

  const DEFAULT_SETTINGS = { buffer_days: 3, avg_household_size: 2 };   // 在宅避難は高齢世帯が中心のため平均2人と見る

  function setting(settings, key){
    const v = settings ? Number(settings[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SETTINGS[key];
  }

  const TARGET_LABEL = { all: "全員", adult: "大人", child: "子ども", infant: "乳幼児", elderly: "高齢者" };
  const TARGET_FIELD = { infant: "infants", elderly: "elderly" };

  /* 対象人数の解決:
       all    → 世帯数 × 1世帯あたり平均人数（概算）
       infant / elderly → 地区の報告人数。未入力なら1人とみなす
                          （必要と報告された=対象者がいる、という扱い） */
  function peopleFor(rule, report, settings){
    if (!rule.target || rule.target === "all")
      return (Number(report.households) || 0) * setting(settings, "avg_household_size");
    const raw = report[TARGET_FIELD[rule.target]];
    if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw)))
      return Math.max(0, Number(raw));
    return 1;
  }

  /* 1地区×1品目の計算。「必要」と報告されていない品目、対象外は null */
  function calcItem(rule, district, settings){
    if (rule.is_active === false) return null;
    const report = district.report;
    if (!report) return null;
    const entry = (report.needs || {})[rule.id];
    if (!entry) return null;
    const people = peopleFor(rule, report, settings);
    const daily = (Number(rule.daily_amount_per_person) || 0) * people;
    if (daily <= 0) return null;
    const buffer = Number(rule.buffer_days) > 0 ? Number(rule.buffer_days) : setting(settings, "buffer_days");
    return {
      rule, people, daily, buffer,
      need: daily * buffer,                 // 目標日数分の数量
      note: entry && entry.note ? String(entry.note) : "",
    };
  }

  function calcDistrict(district, rules, settings){
    return (rules || []).map(r => calcItem(r, district, settings)).filter(Boolean);
  }

  /* 公開ページ用: 報告のある地区の一覧（地区名順。町ごとの見出しはページ側で付ける） */
  function aggregate(districts, rules, settings){
    return (districts || [])
      .filter(d => d && d.name && d.report)
      .map(d => ({
        name: d.name,
        site: d.site || "",
        lat: Number.isFinite(Number(d.lat)) ? Number(d.lat) : null,
        lng: Number.isFinite(Number(d.lng)) ? Number(d.lng) : null,
        households: Number(d.report.households) || 0,
        notes: d.report.notes || "",
        updatedAt: d.report.updatedAt || "",
        itemList: calcDistrict(d, rules, settings),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }

  /* 全体サマリー（「件」は 地区×品目 の数え方） */
  function summary(districts, rules, settings){
    const s = { districts: 0, households: 0, needCount: 0, items: {} };
    aggregate(districts, rules, settings).forEach(g => {
      s.districts++;
      s.households += g.households;
      g.itemList.forEach(c => {
        s.needCount++;
        const r = s.items[c.rule.id] || (s.items[c.rule.id] = {
          rule: c.rule, districts: 0, households: 0, need: 0, buffer: c.buffer,
        });
        r.districts++;
        r.households += g.households;
        r.need += c.need;
      });
    });
    s.itemList = Object.values(s.items)
      .sort((a, b) => b.districts - a.districts || b.need - a.need);
    return s;
  }

  /* ---------- 表示用フォーマット ---------- */

  function fmtQty(v, unit){
    if (!Number.isFinite(v) || v <= 0) return "0" + (unit || "");
    if (unit === "ml"){
      if (v >= 1000) return (Math.ceil(v / 100) / 10).toFixed(1) + "L";
      return Math.ceil(v) + "ml";
    }
    const n = Math.ceil(v);   // 概算なので切り上げの整数で十分
    return String(n) + (unit || "");
  }

  /* なじみのある単位への換算の補足（「2Lペット 約12本」）。なければ空文字 */
  function packHint(rule, v){
    if (!Number.isFinite(v) || v <= 0) return "";
    const packs = (rule.packs || []).filter(p => Number(p.factor) > 1 && p.unit && p.unit !== rule.unit);
    if (!packs.length) return "";
    const p = packs.reduce((a, b) => (Number(b.factor) > Number(a.factor) ? b : a));
    return `${p.label} 約${Math.ceil(v / Number(p.factor))}${p.unit}`;
  }

  function fmtQtyWithPack(rule, v){
    const base = fmtQty(v, rule.unit);
    const hint = packHint(rule, v);
    return hint ? `${base}（${hint}）` : base;
  }

  function targetLabel(rule){ return TARGET_LABEL[rule.target || "all"] || "全員"; }

  return {
    DEFAULT_SETTINGS, setting, peopleFor,
    calcItem, calcDistrict, aggregate, summary,
    fmtQty, packHint, fmtQtyWithPack, targetLabel,
  };
})();

/* Node.js からのテスト用（ブラウザでは何もしない） */
if (typeof module !== "undefined" && module.exports) module.exports = ZCALC;
