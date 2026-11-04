// Headless check of the living face (faceAnimation): eyes following the camera from several sides,
// lids following the gaze, and the lip shapes (visemes). Head close-ups.
// Usage: node scripts/living.mjs [url] [outDir]   (url may carry ?webgpu)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/living"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
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
const t0 = Date.now();
await page.evaluate(async () => {
  const { character } = window.__actors;
  await character.set({ animation: null, outfit: ["briefs"], expressionIntensity: 1, expression: "neutral", faceRig: true, faceAnimation: true, gaze: "camera", body: { gender: 0.05 } });
  const a = character.faceAnimator;
  a.options.blink = a.options.saccades = a.options.idle = false;
});
console.log(`living face on: ${Date.now() - t0} ms, eye bones: ${await page.evaluate(() => window.__actors.character.actor.eyesEnabled)}`);
const h = await page.evaluate(() => window.__actors.character.height);
const s = h / 1.7, y = h - 0.12 * s;
// Camera: the eyes look at it. A second point (the look target) can differ from the camera.
const shot = async (name, cam, look) => {
  await page.evaluate(({ cam, look, y }) => {
    const { stage, character } = window.__actors;
    stage.view(cam, [0, y - 0.01, 0]);
    character.lookAt(look ? new (character.object.position.constructor)(...look) : undefined);
    for (let i = 0; i < 30; i++) character.update(1 / 60);
  }, { cam, look, y });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
};
await shot("gaze-front", [0, y, 0.6 * s]);
await shot("gaze-camera-left", [0.35 * s, y, 0.5 * s]);
await shot("gaze-camera-right", [-0.35 * s, y, 0.5 * s]);
await shot("gaze-camera-above", [0, y + 0.35 * s, 0.5 * s]);
await shot("gaze-camera-below", [0, y - 0.3 * s, 0.5 * s]);
await shot("look-left", [0, y, 0.6 * s], [2, y, 1]);
await shot("look-down", [0, y, 0.6 * s], [0, 0, 1]);
await shot("look-up", [0, y, 0.6 * s], [0, y + 2, 1]);
await shot("look-near", [0, y, 0.6 * s], [0, y - 0.02, 0.18]);
// Visemes, held.
const visemes = await page.evaluate(() => Object.keys(window.__actors.character.constructor.VISEMES ?? {}));
for (const v of visemes.length ? visemes : ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"]) {
  await page.evaluate(({ v, y, s }) => {
    const { stage, character } = window.__actors;
    stage.view([0.1 * s, y - 0.02 * s, 0.5 * s], [0, y - 0.03 * s, 0]);
    character.lookAt(undefined);
    character.speak([{ time: 0, viseme: v }, { time: 5, viseme: v }]);
    for (let i = 0; i < 20; i++) character.update(1 / 60);
  }, { v, y, s });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/viseme-${v}.png` });
}
// Frame cost of the living face (CPU side), 600 updates.
const ms = await page.evaluate(() => {
  const { character } = window.__actors;
  const a = character.faceAnimator;
  a.options.blink = a.options.saccades = a.options.idle = true;
  character.say("The quick brown fox jumps over the lazy dog.");
  const t = performance.now();
  for (let i = 0; i < 600; i++) character.update(1 / 60);
  const all = performance.now() - t;
  return all / 600;
});
console.log(`Character.update with a living face: ${ms.toFixed(3)} ms per frame (includes the mixer)`);
if (errors.length) console.log("errors:", errors);
await browser.close();
