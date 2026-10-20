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
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });
await page.waitForTimeout(2000);

const shot = async (name, wait = 800) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("saved", name);
};
const set = (fn, arg) => page.evaluate(fn, arg);
const params = (p) => set(async (p) => {
  Object.assign(window.__actors.human.params, p);
  await window.__actors.refresh();
}, p);
const camera = (pos, target) => set(([pos, target]) => window.__actors.view(pos, target), [pos, target]);
const anim = (v) => page.selectOption("#anim", v);
const outfit = (names) => set((names) => {
  for (const box of document.querySelectorAll("#outfit input")) {
    const on = names.includes(box.dataset.garment);
    if (box.checked !== on) box.click();
  }
}, names);

await shot("idle");
await anim("");
await params({ gender: 0, cupSize: 0.65, ageYears: 28 });
await shot("female");
await camera([0.15, 1.52, 0.6], [0, 1.5, 0]);
await page.selectOption("#expression", "smile");
await shot("face-smile");
await page.selectOption("#expression", "surprise");
await shot("face-surprise");
await page.selectOption("#expression", "neutral");
await camera([0.25, 1.0, 1.4], [0, 0.95, 0]);
await shot("torso-female");
await params({ gender: 1, muscle: 0.75, weight: 0.55, ageYears: 40 });
await shot("torso-male");
await camera([0.6, 1.2, 4.2], [0, 0.95, 0]);
await outfit(["briefs", "jeans", "tshirt", "socks"]);
await shot("outfit-casual");
await params({ gender: 0, cupSize: 0.6 });
await outfit(["briefs", "bra", "skirt", "longsleeve", "tights"]);
await shot("outfit-skirt");
await anim("walk");
await shot("walk", 1500);
await outfit([]);
await anim("jog");
await shot("jog", 1200);
await anim("dance");
await shot("dance", 2500);
await camera([1.2, 1.0, 1.0], [0, 0.9, 0]);
await anim("");
await set(() => window.__actors.actor.bones.forEach((b) => {
  if (b.name === "thigh_l" || b.name === "thigh_r") b.rotateX(-1.4);
  if (b.name === "calf_l" || b.name === "calf_r") b.rotateX(1.9);
  if (b.name === "upperarm_l" || b.name === "upperarm_r") b.rotateX(-1.2);
  if (b.name === "lowerarm_l" || b.name === "lowerarm_r") b.rotateX(-1.6);
}));
await shot("joints-bent");
const status = await page.textContent("#status");
console.log("status:", status);
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
