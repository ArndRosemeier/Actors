// Close-ups of the feet in every shoe, to check fit: snug, no skin through, no leg cut away above the
// shoe. One image per shoe (shoes-<id>.png): female and male, from the side and the front, in idle and
// mid-stride, plus bare feet for scale (shoes-barefoot.png).
// Usage: node scripts/shoes.mjs [url] [outDir] [--only id,id]   (dev server must be running)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
const args = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--only");
const url = args[0] ?? "http://localhost:5173/";
const out = args[1] ?? "screenshots/shoes";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });
const catalog = await page.evaluate(() => window.__actors.character.catalog);
const shoes = catalog.garments.filter((g) => g.category === "Shoes" && (!only || only.includes(g.id)));

// Renders tiles into one canvas: each tile is [gender, clip, time, camera pos, target].
const W = 360, H = 400;
const TILES = [
  [0.05, null, 0, [0.95, 0.2, 0.1], [0.09, 0.1, 0.03]],
  [0.05, null, 0, [0.4, 0.45, 1.35], [0.09, 0.22, 0.03]],
  [0.05, "walk", 0.3, [1.6, 0.4, 0.1], [0.09, 0.28, 0.03]],
  [0.95, null, 0, [1.0, 0.2, 0.1], [0.1, 0.1, 0.03]],
  [0.95, null, 0, [0.42, 0.45, 1.4], [0.1, 0.22, 0.03]],
  [0.95, "walk", 0.3, [1.65, 0.4, 0.1], [0.1, 0.28, 0.03]],
];
await page.evaluate(({ W, H }) => {
  const { stage } = window.__actors;
  const c = document.createElement("canvas");
  c.width = W * 3;
  c.height = H * 2;
  window.__sheet = { c, ctx: c.getContext("2d") };
  stage.renderer.setAnimationLoop?.(null);
}, { W, H });

const shoot = async (name, outfit) => {
  for (let i = 0; i < TILES.length; i++) {
    const [gender, clip, t, pos, target] = TILES[i];
    await page.evaluate(async ({ gender, clip, t, outfit }) => {
      const { character } = window.__actors;
      await character.set({ body: { gender, ageYears: 30, muscle: 0.5, weight: 0.5 }, details: {}, outfit, hair: null, animation: clip, expression: "neutral" });
      await character.seek(clip ? t : null);
    }, { gender, clip, t, outfit });
    await page.waitForTimeout(400);
    await page.evaluate(({ i, pos, target, W, H }) => {
      const { stage } = window.__actors;
      stage.view(pos, target);
      const r = stage.renderer;
      r.render(stage.scene, stage.camera);
      const src = r.domElement;
      // Centre crop of the canvas at the tile's aspect.
      const s = Math.min(src.width / W, src.height / H);
      const sw = W * s, sh = H * s;
      window.__sheet.ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, (i % 3) * W, Math.floor(i / 3) * H, W, H);
    }, { i, pos, target, W, H });
  }
  const data = await page.evaluate(() => window.__sheet.c.toDataURL("image/png"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${out}/shoes-${name}.png`, Buffer.from(data.split(",")[1], "base64"));
  console.log("saved", name);
};

if (!only) await shoot("barefoot", []);
for (const g of shoes) await shoot(g.id, [g.id]);
await page.evaluate(() => window.__actors.character.seek(null));
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
await browser.close();
