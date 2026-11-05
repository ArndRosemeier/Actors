// Checks the caller restrictions (`allow`): races, robots, clothing categories and the height range.
// Usage: node scripts/allow.mjs [baseUrl] [outDir]
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5173/";
const out = process.argv[3] ?? "screenshots/allow";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const open = async (query) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + query);
  await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  return page;
};
const info = (page) => page.evaluate(() => {
  const c = window.__actors.character;
  return { races: c.catalog.races.map((r) => r.id), robot: !!c.catalog.robot, skeletal: !!c.catalog.skeletal, garments: c.catalog.garments.length, future: c.catalog.garments.some((g) => g.id.startsWith("future-")), medieval: c.catalog.garments.some((g) => g.id.startsWith("med-")), height: c.height, config: c.config };
});

// City life: humans only, today's clothes, everyday heights; no race or kind pickers.
let page = await open("?allow=city");
let c = await info(page);
assert.deepEqual(c.races, ["human"]);
assert(!c.robot && !c.skeletal && !c.future && !c.medieval);
assert(!(await page.isVisible('select[data-key="race"]')));
await page.evaluate(() => window.__actors.character.set({ body: { height: 1, gender: 1 } }));
await page.waitForTimeout(1500);
c = await info(page);
assert(c.height <= 2.05 + 1e-3, `city height ${c.height}`);
await page.screenshot({ path: `${out}/city.png` });
console.log("city", c.races, c.garments, c.height.toFixed(3));
await page.close();

// Science fiction: humans and robots, the 3026 wardrobe.
page = await open("?allow=scifi");
c = await info(page);
assert.deepEqual(c.races, ["human"]);
assert(c.robot && !c.skeletal && c.future && !c.medieval);
await page.selectOption('select[data-key="kind"]', "robot");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/scifi-robot.png` });
console.log("scifi", c.garments);
await page.close();

// Robots only: no living people.
page = await open("?races=robot");
c = await info(page);
assert(c.config.robot, "robots only makes a robot");
await page.click('button[data-role="randomize"]');
await page.waitForTimeout(2500);
assert((await info(page)).config.robot);
console.log("robots only ok");
await page.close();

// Fantasy with a height cap: a giantkin is scaled down to 2.2 m.
page = await open("?allow=fantasy&maxHeight=2.2&minHeight=1.2");
c = await info(page);
assert(c.races.includes("giantkin") && !c.robot && c.skeletal && c.medieval && !c.future);
await page.evaluate(() => window.__actors.character.setRace("giantkin"));
await page.waitForTimeout(2500);
c = await info(page);
assert(Math.abs(c.height - 2.2) < 0.01, `giantkin height ${c.height}`);
await page.evaluate(() => window.__actors.character.setRace("goblin"));
await page.waitForTimeout(2500);
const goblin = await info(page);
assert(Math.abs(goblin.height - 1.2) < 0.01, `goblin height ${goblin.height}`);
await page.$$eval('button[data-tab="detailed"]', (bs) => bs.forEach((b) => b.click()));
await page.screenshot({ path: `${out}/fantasy-goblin-detailed.png` });
console.log("fantasy", c.height.toFixed(3), goblin.height.toFixed(3));
await page.close();

await browser.close();
console.log("errors:", errors.length ? errors.join("\n") : "none");
if (errors.length) process.exit(1);
