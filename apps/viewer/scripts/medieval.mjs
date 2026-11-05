// Medieval wardrobe check: every "Medieval · " outfit preset on a female and a male body,
// front and back, standing and mid-walk, plus single pieces up close. Start the viewer first.
// CHROMIUM_PATH=/path/to/chrome node apps/viewer/scripts/medieval.mjs [url] [outDir] [--only id,id]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1].split(",") : null;
const url = args[0] ?? "http://localhost:5173/";
const out = args[1] ?? ".cache/medieval";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__actors?.ready, undefined, { timeout: 180000 });
  await page.$$eval('button[data-tab="detailed"]', (bs) => bs.forEach((b) => b.click()));
  const outfits = await page.evaluate(() => window.__actors.character.catalog.outfits.filter((o) => o.label.startsWith("Medieval · ")).map((o) => ({ id: o.id, gender: o.gender })));
  const view = (pos, target) => page.evaluate(([p, t]) => window.__actors.stage.view(p, t), [pos, target]);
  for (const { id, gender: only1 } of outfits) {
    if (only && !only.includes(id)) continue;
    for (const gender of [0.1, 0.9]) {
      if ((only1 === "male" && gender < 0.5) || (only1 === "female" && gender > 0.5)) continue;
      const tag = `${id}-${gender < 0.5 ? "f" : "m"}`;
      await page.evaluate(async ([id, gender]) => {
        const { character } = window.__actors;
        await character.set({ body: { gender, ageYears: 32, muscle: gender > 0.5 ? 0.7 : 0.4, weight: 0.5 }, hair: gender > 0.5 ? "hair-short02" : "hair-ponytail01", animation: "idle", blink: false });
        await character.wear(id);
        await character.set({});
        character.seek(0.5);
      }, [id, gender]);
      const pieces = await page.evaluate(() => {
        const { character } = window.__actors;
        return character.config.outfit.filter((id) => id.startsWith("med-")).map((id) => {
          const mesh = character.actor.meshes.get(id);
          return { id, ok: !!mesh && mesh.geometry.getAttribute("position").count > 0 && Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite) };
        });
      });
      for (const p of pieces) assert(p.ok, `${tag}: ${p.id} missing or broken`);
      await view([0.9, 1.2, 3.6], [0, 0.95, 0]);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${tag}-front.png` });
      if (gender < 0.5) {
        // Upper chest up close: the gap between a mantle or collar and the neckline must show cloth or
        // skin, never the background (a garment that hid the skin under a see-through lace band did).
        const chest = await page.evaluate(() => {
          const { character } = window.__actors;
          const neck = character.object.getObjectByName("neck_01")?.getWorldPosition(new window.__actors.stage.camera.position.constructor());
          return neck ? [neck.x, neck.y, neck.z] : null;
        });
        assert(chest, `${tag}: no neck bone`);
        const y = chest[1] - 0.12;
        await view([0, y, chest[2] + 0.75], [0, y, chest[2]]);
        // A magenta backdrop for the check, so dark cloth isn't mistaken for the background.
        const bg = await page.evaluate(() => { const b = window.__actors.stage.scene.background, old = b.getHex(); b.set(0xff00ff); return old; });
        await page.waitForTimeout(700);
        const shot = await page.screenshot();
        await page.evaluate((bg) => window.__actors.stage.scene.background.set(bg), bg);
        await page.screenshot({ path: `${out}/${tag}-chest.png` });
        const a = PNG.sync.read(shot);
        // Box over the sternum and the upper chest (between the collarbones and the bust), in the middle of the 3D view.
        const r = await page.evaluate(() => { const c = window.__actors.stage.renderer.domElement.getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
        let holes = 0, total = 0;
        for (let py = Math.round(r.y + r.h * 0.38); py < r.y + r.h * 0.62; py++)
          for (let px = Math.round(r.x + r.w * 0.4); px < r.x + r.w * 0.6; px++) {
            const i = (py * a.width + px) * 4;
            total++;
            if (a.data[i] > 235 && a.data[i + 1] < 20 && a.data[i + 2] > 235) holes++;
          }
        assert(holes < total * 0.002, `${tag}: see-through chest, ${holes} of ${total} pixels show the background (${out}/${tag}-chest.png)`);
      }
      await view([-0.9, 1.3, -3.6], [0, 0.95, 0]);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${tag}-back.png` });
      await page.evaluate(async () => { await window.__actors.character.set({ animation: "walk" }); window.__actors.character.seek(0.35); });
      await view([2.6, 1.1, 2.4], [0, 0.9, 0]);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${tag}-walk.png` });
      console.log("saved", tag);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
