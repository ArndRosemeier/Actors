// Headless check of expression wrinkles: head close-ups of each expression with wrinkles off and on,
// and an old face at rest. Usage: node scripts/wrinkles.mjs [url] [outDir]   (url may carry ?webgpu)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/wrinkles"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });
const only = process.env.EXPRESSIONS?.split(",") ?? ["neutral", "surprise", "angry", "smile", "laugh", "disgust"];
await page.evaluate(async () => {
  const { character } = window.__actors;
  character.expressionFade = 0;
  await character.set({ animation: null, outfit: ["briefs"], blink: false, expressionIntensity: 1, body: { gender: 0.6, ageYears: 40 } });
});
const view = async (side = 0.18) => {
  const h = await page.evaluate(() => window.__actors.character.height);
  await page.evaluate(({ h, side }) => {
    const s = h / 1.7, y = h - 0.12 * s;
    window.__actors.stage.view([side * s, y, 0.5 * s], [0, y - 0.01, 0]);
  }, { h, side });
};
await view();
for (const e of only)
  for (const on of [false, true]) {
    await page.evaluate(async ({ e, on }) => {
      const { character } = window.__actors;
      await character.set({ expression: e, wrinkles: on });
      character.update(0.016);
    }, { e, on });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${e}-${on ? "on" : "off"}.png` });
  }
await page.evaluate(async () => {
  const { character } = window.__actors;
  await character.set({ expression: "neutral", wrinkles: true, body: { ageYears: 85 } });
  character.update(0.016);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/old-rest.png` });
if (errors.length) console.log("errors:", errors);
await browser.close();
