"use strict";
/* 炊き出し告知: A4掲示用(300dpi PNG) と SNS用(1080x1920) を書き出す */
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const DIR = __dirname;
const INFO = JSON.parse(fs.readFileSync(path.join(DIR, "info.json"), "utf8"));

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const errs = [];

  // A4: 1240x1754 CSS px を 2倍で撮ると 2480x3508 = A4 300dpi
  const ctxA4 = await b.newContext({ viewport: { width: 1300, height: 1800 }, deviceScaleFactor: 2 });
  const pA4 = await ctxA4.newPage();
  pA4.on("pageerror", e => errs.push("a4: " + e));
  await pA4.addInitScript(i => { window.__INFO__ = i; }, INFO);
  await pA4.goto("file://" + path.join(DIR, "poster.html"), { waitUntil: "networkidle" });
  await pA4.waitForTimeout(400);
  await pA4.locator("#a4").screenshot({ path: path.join(DIR, "炊き出し-掲示用A4.png") });

  // SNS: 1080x1920 等倍
  const ctxSns = await b.newContext({ viewport: { width: 1100, height: 1960 }, deviceScaleFactor: 1 });
  const pSns = await ctxSns.newPage();
  pSns.on("pageerror", e => errs.push("sns: " + e));
  await pSns.addInitScript(i => { window.__INFO__ = i; }, INFO);
  await pSns.goto("file://" + path.join(DIR, "poster.html"), { waitUntil: "networkidle" });
  await pSns.waitForTimeout(400);
  await pSns.locator("#sns").screenshot({ path: path.join(DIR, "炊き出し-SNS用.png") });

  console.log(JSON.stringify({ errs, when: INFO.when || "(空欄)" }));
  await b.close();
})();
