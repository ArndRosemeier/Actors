// Navy wardrobe check: every "Navy · " outfit preset front, back, mid-walk, a close-up of the head and
// shoulders (hats, collars, epaulettes) and the view down at his own hands and legs (the first-person
// captain), plus checks that the generated pieces are present
// and finite. Start the viewer first.
// CHROMIUM_PATH=/path/to/chrome node apps/viewer/scripts/navy.mjs [url] [outDir] [--only id,id]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1].split(",") : null;
const url = args[0] ?? "http://localhost:5173/";
const out = args[1] ?? ".cache/navy";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
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
  const outfits = await page.evaluate(() => window.__actors.character.catalog.outfits.filter((o) => o.label.startsWith("Navy · ")).map((o) => ({ id: o.id, gender: o.gender })));
  assert(outfits.length > 0, "no navy presets in this pack");
  const view = (pos, target) => page.evaluate(([p, t]) => window.__actors.stage.view(p, t), [pos, target]);
  for (const { id, gender: only1 } of outfits) {
    if (only && !only.includes(id)) continue;
    for (const gender of [0.1, 0.9]) {
      if ((only1 === "male" && gender < 0.5) || (only1 === "female" && gender > 0.5)) continue;
      const tag = `${id}-${gender < 0.5 ? "f" : "m"}`;
      await page.evaluate(async ([id, gender]) => {
        const { character } = window.__actors;
        await character.set({ body: { gender, ageYears: 32, muscle: gender > 0.5 ? 0.6 : 0.4, weight: 0.5 }, hair: gender > 0.5 ? "hair-short02" : "hair-bob-curled", animation: "idle", blink: false });
        await character.wear(id);
        await character.set({});
        character.seek(0.5);
      }, [id, gender]);
      const pieces = await page.evaluate(() => {
        const { character } = window.__actors;
        return character.config.outfit.filter((id) => id.startsWith("navy-")).map((id) => {
          const mesh = character.actor.meshes.get(id);
          return { id, ok: !!mesh && mesh.geometry.getAttribute("position").count > 0 && Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite) };
        });
      });
      for (const p of pieces) assert(p.ok, `${tag}: ${p.id} missing or broken`);
      await view([0.9, 1.2, 3.6], [0, 0.95, 0]);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${tag}-front.png` });
      const head = await page.evaluate(() => {
        const { character, stage } = window.__actors;
        const p = character.object.getObjectByName("neck_01")?.getWorldPosition(new stage.camera.position.constructor());
        return p ? [p.x, p.y, p.z] : null;
      });
      assert(head, `${tag}: no neck bone`);
      await view([0.35, head[1] + 0.1, head[2] + 1.1], [0, head[1] + 0.05, head[2]]);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${tag}-close.png` });
      // The captain's own view: from the eyes, down at his hands, cuffs, breeches and shoes.
      const eyes = await page.evaluate(() => {
        const { character, stage } = window.__actors;
        const p = character.object.getObjectByName("neck_01")?.getWorldPosition(new stage.camera.position.constructor());
        return p ? [p.x, p.y + 0.17, p.z + 0.1] : null;
      });
      // A first-person lens (the stage's own is a narrow 30 degrees), just in front of the face.
      const fov = (f) => page.evaluate((f) => { const c = window.__actors.stage.camera; c.fov = f; c.updateProjectionMatrix(); }, f);
      await fov(80);
      await view([eyes[0], eyes[1] - 0.02, eyes[2] + 0.17], [eyes[0], 0.4, eyes[2] + 0.22]);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${tag}-down.png` });
      await fov(30);
      await view([-0.9, 1.3, -3.6], [0, 0.95, 0]);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${tag}-back.png` });
      // The crowd level (one merged mesh with vertex colours), as most of a crew is drawn.
      await page.evaluate(() => window.__actors.character.setLod(2));
      await view([0.9, 1.2, 3.6], [0, 0.95, 0]);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${tag}-crowd.png` });
      await page.evaluate(() => window.__actors.character.setLod("auto"));
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
