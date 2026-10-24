// Headless check of the skeleton actors: full body front/side/back, skull close-ups,
// hands and feet, palettes, bodies and races, frames of a walk, and one in clothes.
// Usage: node scripts/skeletons.mjs [url] [outDir]   (SHOTS=front,skull,... picks shots)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/skeletons"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
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
const full = () => view([0.9, 1.15, 3.6], [0, 0.92, 0]);
const height = () => page.evaluate(() => window.__actors.character.height);
const only = process.env.SHOTS?.split(",");
const want = (name) => !only || only.some((o) => name.startsWith(o));

const t0 = Date.now();
await set({ skeletal: true, outfit: [], animation: null, body: { gender: 1, height: 0.55 } });
console.log("skeleton built in", Date.now() - t0, "ms");
const ms = await page.evaluate(async () => {
  const c = window.__actors.character;
  const t = performance.now();
  await c.set({ body: { height: 0.56 } });
  return performance.now() - t;
});
console.log("shape update", Math.round(ms), "ms");

if (want("front")) {
  await full();
  await shot("front");
}
if (want("side")) {
  await view([3.6, 1.15, 0.2], [0, 0.92, 0]);
  await shot("side");
}
if (want("back")) {
  await view([-0.9, 1.2, -3.6], [0, 0.92, 0]);
  await shot("back");
}
if (want("torso")) {
  const h = await height();
  await view([0.45, h - 0.35, 1.1], [0, h - 0.45, 0]);
  await shot("torso");
  await view([1.1, h - 0.4, -0.6], [0, h - 0.48, 0]);
  await shot("torso-back");
}
if (want("pelvis")) {
  await view([0.5, 1.05, 0.9], [0, 0.92, 0]);
  await shot("pelvis");
}
if (want("skull")) {
  const h = await height();
  const c = [0, h - 0.14, 0.03];
  await view([0, h - 0.12, 0.95], c);
  await shot("skull-front");
  await view([0.95, h - 0.12, 0.03], c);
  await shot("skull-side");
  await view([0.62, h - 0.02, 0.7], c);
  await shot("skull-34");
}
if (want("hands")) {
  const hand = await page.evaluate(() => {
    let p = null;
    window.__actors.character.object.traverse((o) => {
      if (!p && o.isBone && o.name === "hand_l") p = o.getWorldPosition(o.position.clone()).toArray();
    });
    return p;
  });
  await view([hand[0] + 0.5, hand[1] + 0.25, hand[2] + 0.5], [hand[0], hand[1] - 0.06, hand[2]]);
  await shot("hands");
}
if (want("feet")) {
  await view([0.5, 0.25, 0.6], [0.1, 0.05, 0.05]);
  await shot("feet");
}
const palettes = await page.evaluate(() => window.__actors.character.catalog.skeletal.palettes);
for (const [i, p] of palettes.entries()) {
  if (!want(`palette-${p.id}`)) continue;
  const female = i % 2 === 1;
  await set({ skeletalLook: { ...p.look, missing: i % 3 === 2 ? 0.6 : 0 }, body: { gender: female ? 0.05 : 0.95, height: 0.3 + (i % 4) * 0.15 } });
  await full();
  await shot(`palette-${p.id}`);
}
if (want("female")) {
  await set({ skeletalLook: palettes[0].look, body: { gender: 0, height: 0.45 } });
  await full();
  await shot("female");
  await view([0.5, 1.05, 0.9], [0, 0.92, 0]);
  await shot("female-pelvis");
}
if (want("walk")) {
  await set({ body: { gender: 0.95, height: 0.55 }, skeletalLook: palettes[0].look, animation: "walk" });
  for (const t of [0.15, 0.45]) {
    await page.evaluate((t) => window.__actors.character.seek(t), t);
    await full();
    await shot(`walk-${t}`);
  }
  await page.evaluate(() => window.__actors.character.seek(null));
  await set({ animation: null });
}
if (want("race")) {
  await set({ race: "orc", horns: "ram", tusks: 0.7 });
  const h = await height();
  await view([0.35, h - 0.05, 0.6], [0, h - 0.12, 0]);
  await shot("race-orc-head");
  await set({ race: "human", horns: "none", tusks: 0 });
}
if (want("clothes")) {
  await set({ outfit: ["briefs", "viking-tunic", "viking-pants", "viking-boots", "knight-helmet"], skeletalLook: { wear: 0.6 } });
  await full();
  await shot("clothes-knight");
  await set({ outfit: ["monk-robe", "monk-hood"] });
  await full();
  await shot("clothes-monk");
  await set({ outfit: [] });
}
if (want("human")) {
  await set({ skeletal: false });
  await full();
  await shot("back-to-human");
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors");
await browser.close();
