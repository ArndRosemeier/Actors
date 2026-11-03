// Headless check of the face rig: every expression with the rig off (old morph channel) and on,
// head close-ups side by side, a blend half way, and what the rig costs (build time, texture).
// Usage: node scripts/faces.mjs [url] [outDir]   (url may carry ?webgpu)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/faces"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
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
const only = process.env.EXPRESSIONS?.split(",");
const expressions = (await page.evaluate(() => window.__actors.character.catalog.expressions.map((e) => e.id))).filter((e) => !only || only.includes(e));
const head = async () => {
  const h = await page.evaluate(() => window.__actors.character.height);
  await page.evaluate((h) => {
    const y = h - 0.12 * (h / 1.7);
    window.__actors.stage.view([0.18 * (h / 1.7), y, 0.62 * (h / 1.7)], [0, y - 0.01, 0]);
  }, h);
};
await page.evaluate(async () => {
  const { character } = window.__actors;
  character.expressionFade = 0;
  await character.set({ animation: null, outfit: ["briefs"], blink: false, expressionIntensity: 1, body: { gender: 0.05 } });
});
await head();
for (const rig of [false, true]) {
  const ms = await page.evaluate(async (rig) => {
    const t0 = performance.now();
    await window.__actors.character.set({ faceRig: rig });
    return performance.now() - t0;
  }, rig);
  const info = await page.evaluate(() => {
    const a = window.__actors.character.actor;
    const t = a.face.uFaceRig.value.image;
    return { units: a.faceUnits().length, texture: `${t.width}x${t.height}`, mb: ((t.width * t.height * 8) / 1e6).toFixed(1) };
  });
  console.log(`rig ${rig ? "on" : "off"}: switch ${ms.toFixed(0)} ms, ${info.units} units, texture ${info.texture} (${info.mb} MB)`);
  for (const e of expressions) {
    await page.evaluate(async (e) => {
      const { character } = window.__actors;
      await character.set({ expression: e });
      character.update(0.016);
    }, e);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${e}-${rig ? "rig" : "channel"}.png` });
  }
}
// Half way from smile to surprise.
await page.evaluate(async () => {
  const { character } = window.__actors;
  const update = character.update.bind(character);
  character.update = () => {}; // the stage's frames must not advance the blend
  character.expressionFade = 1;
  await character.set({ expression: "smile" });
  update(2);
  await character.set({ expression: "surprise" });
  update(0.5);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/blend-smile-surprise.png` });
// Shape change with the rig on: the rig is rebuilt in the worker.
const rebuild = await page.evaluate(async () => {
  const { character } = window.__actors;
  const t0 = performance.now();
  await character.set({ body: { weight: 0.8 } });
  return performance.now() - t0;
});
console.log(`shape change with rig: ${rebuild.toFixed(0)} ms`);
if (errors.length) console.log("errors:", errors);
await browser.close();
