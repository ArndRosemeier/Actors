// Headless check of the fantasy races: one full-body shot per race (female and
// male, bind pose) plus head close-ups. Usage: node scripts/races.mjs [url] [outDir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/races"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });
const races = await page.evaluate(() => window.__actors.character.catalog.races.map((r) => r.id));
const only = process.env.RACES?.split(",");
for (const race of races) {
  if (only && !only.includes(race)) continue;
  for (const [g, gender] of [["f", 0.05], ["m", 0.95]]) {
    const h = await page.evaluate(async ([race, gender]) => {
      const { character } = window.__actors;
      await character.set({ race, race2: null, body: { gender }, animation: null, outfit: ["briefs"], expression: "neutral" });
      return character.height;
    }, [race, gender]);
    await page.evaluate((h) => {
      const k = h / 1.7;
      window.__actors.stage.view([0.6 * k, 1.2 * k, 4.2 * k], [0, 0.95 * k, 0]);
    }, h);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${race}-${g}.png` });
    await page.evaluate((h) => {
      const y = h - 0.13 * (h / 1.7);
      window.__actors.stage.view([0.35 * (h / 1.7), y, 0.75 * (h / 1.7)], [0, y - 0.02, 0]);
    }, h);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${race}-${g}-head.png` });
    console.log(race, g, h.toFixed(2));
  }
}
// Clothed and walking: garments, hair and the retargeted clip on non-human proportions.
for (const [race, gender, outfit, hair] of [["dwarf", 0.95, "casual", "hair-long01"], ["goblin", 0.05, "mini-skirt", "hair-bob01"], ["giantkin", 0.95, "layers", "hair-short02"], ["elf", 0.05, "long-skirt", "hair-braid01"]]) {
  if (only && !only.includes(race)) continue;
  const h = await page.evaluate(async ([race, gender, outfit, hair]) => {
    const { character } = window.__actors;
    await character.set({ race, body: { gender }, hair, animation: "walk" });
    await character.wear(outfit);
    return character.height;
  }, [race, gender, outfit, hair]);
  await page.evaluate((h) => {
    const k = h / 1.7;
    window.__actors.stage.view([2.4 * k, 1.1 * k, 3.4 * k], [0, 0.9 * k, 0]);
  }, h);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${race}-walk.png` });
  console.log(race, "walk");
}
if (errors.length) console.log("errors:", errors);
await browser.close();
