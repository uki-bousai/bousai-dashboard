/* ============================================================
   在宅避難者 物資計算ロジック（共有）

   zaitaku-admin.html（入力画面）と zaitaku.html（公開集計ページ）の
   両方から読み込んで使う。

   考え方:
     利用者には「足りているか」を判断させない。
     入力は「世帯人数」と「残量」だけ。
     ここで「1日必要量」「あと何日分か」「補充必要量」を計算する。

   計算基準（1人1日あたりの量・目標日数・しきい値）は
   zaitaku.json の rules / settings に持ち、入力画面から変更できる。
   ============================================================ */
"use strict";

const ZCALC = (() => {

  /* ステータス（優先順位づけのため日数から自動判定。閾値は settings で変更可能） */
  const STATUS = [
    { key: "critical",  label: "最優先",       range: "1日未満" },
    { key: "priority",  label: "優先",         range: "1〜2日" },
    { key: "candidate", label: "補充候補",     range: "2〜3日" },
    { key: "ok",        label: "当面対応不要", range: "3日以上" },
  ];

  const DEFAULT_SETTINGS = { buffer_days: 3, critical_days: 1, priority_days: 2, warning_days: 3 };

  function setting(settings, key){
    const v = settings ? Number(settings[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SETTINGS[key];
  }

  function statusLevel(days, settings){
    if (days < setting(settings, "critical_days")) return 0;
    if (days < setting(settings, "priority_days")) return 1;
    if (days < setting(settings, "warning_days"))  return 2;
    return 3;
  }

  /* 残量の正規化: パック数（2Lペット×8本 など）→ 基準単位（L など） */
  function normalizedQty(rule, entry){
    if (!entry || !entry.packs) return 0;
    let q = 0;
    (rule.packs || []).forEach(p => {
      const n = Number(entry.packs[p.label]);
      if (Number.isFinite(n) && n > 0) q += n * (Number(p.factor) || 1);
    });
    return q;
  }

  /* 対象人数の解決:
       all    → 世帯人数
       infant → 乳幼児の人数, elderly → 高齢者の人数 など
     内訳が未入力の世帯でも、その品目の残量が登録されていれば
     「対象者が1人いる」とみなして計算する（登録=必要な世帯、という扱い）。 */
  const TARGET_FIELD = { adult: "adults", child: "children", infant: "infants", elderly: "elderly" };
  const TARGET_LABEL = { all: "全員", adult: "大人", child: "子ども", infant: "乳幼児", elderly: "高齢者" };

  function targetCount(rule, hh, entryExists){
    if (!rule.target || rule.target === "all") return Number(hh.size) || 0;
    const raw = hh[TARGET_FIELD[rule.target]];
    if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw)))
      return Math.max(0, Number(raw));
    return entryExists ? 1 : 0;
  }

  /* 1世帯×1品目の計算。対象外（乳幼児0人など）は null を返す */
  function calcItem(rule, hh, settings){
    if (rule.is_active === false) return null;
    const entry = (hh.inventory || {})[rule.id];
    const tc = targetCount(rule, hh, !!entry);
    const daily = (Number(rule.daily_amount_per_person) || 0) * tc;
    if (daily <= 0) return null;
    const qty = normalizedQty(rule, entry);
    const days = qty / daily;
    const buffer = Number(rule.buffer_days) > 0 ? Number(rule.buffer_days) : setting(settings, "buffer_days");
    const refill = Math.max(0, daily * buffer - qty);   // ローリング補充: 常に buffer 日分を確保
    return {
      rule, targetCount: tc, qty, daily, days, buffer, refill,
      level: statusLevel(days, settings),
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
          rule: c.rule, households: 0, people: 0, daysSum: 0,
          minDays: Infinity, refill: 0, worst: 3, buffer: c.buffer,
        });
        it.households++;
        it.people += c.targetCount;
        it.daysSum += c.days;
        if (c.days < it.minDays) it.minDays = c.days;
        it.refill += c.refill;
        if (c.level < it.worst) it.worst = c.level;
      });
    });
    Object.values(map).forEach(g => {
      g.itemList = Object.values(g.items);
      g.itemList.forEach(it => { it.avgDays = it.daysSum / it.households; });
      g.worst = g.itemList.reduce((w, it) => Math.min(w, it.worst), 3);
    });
    return Object.values(map).sort((a, b) => a.district.localeCompare(b.district, "ja"));
  }

  /* 全体サマリー（ダッシュボード用。件数は 世帯×品目 の数え方） */
  function summary(households, rules, settings){
    const s = { households: 0, people: 0, levels: [0, 0, 0, 0], refillByItem: {} };
    (households || []).forEach(hh => {
      s.households++;
      s.people += Number(hh.size) || 0;
      calcHousehold(hh, rules, settings).forEach(c => {
        s.levels[c.level]++;
        const r = s.refillByItem[c.rule.id] || (s.refillByItem[c.rule.id] = { rule: c.rule, refill: 0 });
        r.refill += c.refill;
      });
    });
    return s;
  }

  /* ---------- 表示用フォーマット ---------- */

  function fmtDays(d){
    if (!Number.isFinite(d)) return "―";
    if (d >= 30) return "30日分以上";
    return (Math.floor(d * 10) / 10).toFixed(1) + "日分";
  }

  function fmtQty(v, unit){
    if (!Number.isFinite(v) || v <= 0) return "0" + (unit || "");
    if (unit === "ml"){
      if (v >= 1000) return (Math.ceil(v / 100) / 10).toFixed(1) + "L";
      return Math.ceil(v) + "ml";
    }
    const n = Math.ceil(v * 10) / 10;
    return (Number.isInteger(n) ? String(n) : n.toFixed(1)) + (unit || "");
  }

  /* 「24L（2Lペットボトル 約12本）」のように、入力に使う単位でも補足する */
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
    STATUS, DEFAULT_SETTINGS, setting, statusLevel,
    normalizedQty, targetCount, calcItem, calcHousehold, aggregate, summary,
    fmtDays, fmtQty, fmtQtyWithPack, targetLabel,
  };
})();

/* Node.js からのテスト用（ブラウザでは何もしない） */
if (typeof module !== "undefined" && module.exports) module.exports = ZCALC;
