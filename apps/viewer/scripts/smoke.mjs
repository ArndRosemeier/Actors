// Headless smoke test: loads the viewer, drives the Character API and the editor,
// saves screenshots. Usage: node scripts/smoke.mjs [url] [outDir] [--all]
// --all also shoots every outfit preset (female and male) and every animation.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const all = process.argv.includes("--all");
const url = args[0] ?? "http://localhost:5173/";
const out = args[1] ?? "screenshots";
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
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });
await page.waitForTimeout(2000);

const shot = async (name, wait = 800) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("saved", name);
};
const set = (patch) => page.evaluate((p) => window.__actors.character.set(p), patch);
const camera = (pos, target) => page.evaluate(([pos, target]) => window.__actors.stage.view(pos, target), [pos, target]);
const seek = (t) => page.evaluate((t) => window.__actors.character.seek(t), t);
const catalog = await page.evaluate(() => window.__actors.character.catalog);

await shot("idle");
// Drive the editor UI once: the clip select, a garment checkbox and an outfit preset.
await page.selectOption('select[data-key="animation"]', "");
await set({ body: { gender: 0, cupSize: 0.65, ageYears: 28 }, hair: "hair-long01" });
await shot("female");
await camera([0.15, 1.52, 0.6], [0, 1.5, 0]);
await page.selectOption('select[data-key="expression"]', "smile");
await shot("face-smile");
await set({ expression: "surprise" });
await shot("face-surprise");
await set({ expression: "neutral", hair: null });
await camera([0.25, 1.0, 1.4], [0, 0.95, 0]);
await shot("torso-female");
await set({ body: { gender: 1, muscle: 0.75, weight: 0.55, ageYears: 40 } });
await shot("torso-male");
await camera([0.6, 1.2, 4.2], [0, 0.95, 0]);
await page.selectOption('select[data-role="outfit-preset"]', "casual");
await shot("outfit-casual", 1500);
await set({ body: { gender: 0, cupSize: 0.6 } });
await page.evaluate(() => window.__actors.character.wear("long-skirt"));
await page.click('input[data-garment="tights"]');
await shot("outfit-skirt");
await set({ animation: "walk" });
await shot("walk", 1500);
await set({ outfit: [], animation: "jog" });
await shot("jog", 1200);
await set({ animation: "dance" });
await shot("dance", 2500);
await page.click('button[data-role="randomize"]');
await shot("random", 2500);

if (all) {
  await camera([0.6, 1.2, 4.2], [0, 0.95, 0]);
  await set({ animation: "walk", hair: "hair-bob01", expression: "neutral" });
  for (const [g, gender] of [["f", 0.05], ["m", 0.95]]) {
    await set({ body: { gender, ageYears: 30, muscle: 0.5, weight: 0.5 }, details: {} });
    for (const o of catalog.outfits) {
      await page.evaluate((id) => window.__actors.character.wear(id), o.id);
      await seek(0.3);
      await shot(`outfit-${g}-${o.id}`, 1200);
    }
    await seek(null);
  }
  await set({ outfit: [] });
  for (const a of catalog.animations) {
    await set({ animation: a.id });
    await seek(0.5);
    await shot(`anim-${a.id.replace(/ /g, "-")}`, 1200);
  }
  await seek(null);
}

await camera([1.2, 1.0, 1.0], [0, 0.9, 0]);
await set({ animation: null });
await page.evaluate(() => window.__actors.character.actor.bones.forEach((b) => {
  if (b.name === "thigh_l" || b.name === "thigh_r") b.rotateX(-1.4);
  if (b.name === "calf_l" || b.name === "calf_r") b.rotateX(1.9);
  if (b.name === "upperarm_l" || b.name === "upperarm_r") b.rotateX(-1.2);
  if (b.name === "lowerarm_l" || b.name === "lowerarm_r") b.rotateX(-1.6);
}));
await shot("joints-bent");
const glb = await page.evaluate(async () => (await window.__actors.character.exportGlb("current")).byteLength);
console.log("glb bytes:", glb);
const status = await page.textContent(".ae-status");
console.log("status:", status);
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length || !glb) process.exit(1);
