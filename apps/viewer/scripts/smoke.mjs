// Headless smoke test: loads the viewer, checks it renders, saves screenshots.
// Usage: node scripts/smoke.mjs [url] [outDir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5173/";
const out = process.argv[3] ?? "screenshots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/idle.png` });

const pose = (sel, value) => page.selectOption("#anim", value);
await pose("#anim", "");
await page.evaluate(() => {
  const { human, refresh } = window.__actors;
  human.params.gender = 0;
  human.params.cupSize = 0.7;
  return refresh();
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/female.png` });
await page.evaluate(() => {
  const { human, refresh } = window.__actors;
  Object.assign(human.params, { gender: 1, muscle: 0.9, weight: 0.6, ageYears: 40 });
  return refresh();
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/male.png` });
await page.evaluate(() => {
  const { actor } = window.__actors;
  for (const n of ["tights", "socks", "skirt"]) actor.setVisible(n, n !== "skirt");
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/outfit.png` });
await pose("#anim", "walk");
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/walk.png` });
const status = await page.textContent("#status");
console.log("status:", status);
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
