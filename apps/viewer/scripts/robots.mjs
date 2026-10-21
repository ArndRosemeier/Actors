// Headless check of the robot actors: full body and head shots for every head
// style and plating, a few palettes and bodies, and frames of a walk.
// Usage: node scripts/robots.mjs [url] [outDir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/robots"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
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

const set = (patch) => page.evaluate((p) => window.__actors.character.set(p), patch);
const view = (pos, target) => page.evaluate(([p, t]) => window.__actors.stage.view(p, t), [pos, target]);
const shot = async (name, wait = 600) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("saved", name);
};
const full = () => view([0.9, 1.25, 3.9], [0, 0.95, 0]);
const head = async () => {
  const h = await page.evaluate(() => window.__actors.character.height);
  await view([0.3, h - 0.08, 0.6], [0, h - 0.13, 0]);
};
const only = process.env.SHOTS?.split(",");
const want = (name) => !only || only.some((o) => name.startsWith(o));

const t0 = Date.now();
await set({ robot: true, animation: null, body: { gender: 1, muscle: 0.6, weight: 0.5, height: 0.6 } });
console.log("robot built in", Date.now() - t0, "ms");
const ms = await page.evaluate(async () => {
  const c = window.__actors.character;
  const t = performance.now();
  await c.set({ body: { muscle: 0.62 } });
  return performance.now() - t;
});
console.log("shape update", Math.round(ms), "ms");

if (want("default")) {
  await full();
  await shot("default-front");
  await view([-2.6, 1.3, -2.8], [0, 0.95, 0]);
  await shot("default-back");
  await head();
  await shot("default-head");
}
for (const h of ["visor", "optics", "mono", "android"]) {
  if (!want(`head-${h}`)) continue;
  await set({ robotLook: { head: h, ears: h === "android" ? "none" : h === "mono" ? "antennae" : h === "optics" ? "fins" : "pods" } });
  await head();
  await shot(`head-${h}`);
}
for (const p of ["sleek", "segmented", "armored"]) {
  if (!want(`plating-${p}`)) continue;
  await set({ robotLook: { plating: p, head: "visor", ears: "pods" } });
  await full();
  await shot(`plating-${p}`);
}
const palettes = await page.evaluate(() => window.__actors.character.catalog.robot.palettes);
for (const [i, p] of palettes.entries()) {
  if (!want(`palette-${p.id}`)) continue;
  const female = i % 2 === 0;
  await set({ robotLook: p.look, body: { gender: female ? 0.05 : 0.95, muscle: 0.3 + (i % 3) * 0.25, weight: 0.35 + (i % 4) * 0.12, cupSize: 0.5 } });
  await full();
  await shot(`palette-${p.id}`);
}
if (want("walk")) {
  await set({ body: { gender: 0.95, muscle: 0.7, weight: 0.5 }, robotLook: palettes[0].look, animation: "walk" });
  for (const t of [0.15, 0.45]) {
    await page.evaluate((t) => window.__actors.character.seek(t), t);
    await full();
    await shot(`walk-${t}`);
  }
  await page.evaluate(() => window.__actors.character.seek(null));
}
if (want("hands")) {
  await set({ animation: null });
  await view([0.75, 0.95, 0.55], [0.35, 0.95, 0]);
  await shot("hands");
}
if (want("race")) {
  await set({ animation: null, race: "giantkin", raceSize: 0.5 });
  await view([1.6, 2.0, 6.5], [0, 1.6, 0]);
  await shot("race-giantkin");
  await set({ race: "human" });
}
if (want("human")) {
  await set({ robot: false });
  await full();
  await shot("back-to-human");
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors");
await browser.close();
