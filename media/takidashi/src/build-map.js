"use strict";
/* 場所の案内図: A4掲示用(300dpi PNG) と SNS用(1080x1920)
   map.png（Googleマップなどの画面写真）を置くとそれを使う。なければ枠だけ出す。 */
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const DIR = __dirname;
const INFO = JSON.parse(fs.readFileSync(path.join(DIR, "info.json"), "utf8"));
const HAS_MAP = fs.existsSync(path.join(DIR, "map.png"));

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const errs = [];
  const shoot = async (sel, w, h, dsf, out) => {
    const ctx = await b.newContext({ viewport: { width: w + 60, height: h + 60 }, deviceScaleFactor: dsf });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(sel + ": " + e));
    await p.addInitScript(([i, m]) => { window.__INFO__ = i; window.__HAS_MAP__ = m; }, [INFO, HAS_MAP]);
    await p.goto("file://" + path.join(DIR, "map-card.html"), { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    await p.locator(sel).screenshot({ path: path.join(DIR, out) });
    await ctx.close();
  };
  await shoot("#a4", 1240, 1754, 2, "場所の案内-掲示用A4.png");
  await shoot("#sns", 1080, 1920, 1, "場所の案内-SNS用.png");
  console.log(JSON.stringify({ errs, HAS_MAP, landmarks: INFO.landmarks.length }));
  await b.close();
})();
