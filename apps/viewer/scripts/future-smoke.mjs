// Focused wardrobe integration and visual check. Start the viewer first.
// CHROMIUM_PATH=/path/to/chrome node apps/viewer/scripts/future-smoke.mjs [url] [outDir]
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:5173/";
const out = process.argv[3] ?? ".cache/future-smoke";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__actors?.ready, undefined, { timeout: 120000 });
  const backend = await page.evaluate(() => {
    const r = window.__actors.stage.renderer;
    return r.backend?.isWebGPUBackend ? "webgpu" : r.backend?.isWebGLBackend ? "node-webgl" : "webgl";
  });
  await page.click('button[data-mode="detailed"]');
  const report = [];
  const outfits = await page.evaluate(() => window.__actors.character.catalog.outfits.filter((o) => o.id.startsWith("future-")).map((o) => o.id));
  for (const gender of [0.1, 0.9]) {
    await page.evaluate(async (gender) => {
      const { character, stage } = window.__actors;
      await character.set({ body: { gender, ageYears: 35, muscle: gender > 0.5 ? 0.8 : 0.35, weight: gender > 0.5 ? 0.7 : 0.4 }, anatomy: false, hair: null, animation: "walk", blink: false });
      stage.view([0.5, 1.25, 4.3], [0, 1, 0]);
    }, gender);
    for (const id of outfits) {
      await page.selectOption('select[data-role="outfit-preset"]', id);
      await page.waitForFunction((id) => {
        const c = window.__actors.character;
        return c.config.outfit.join() === c.catalog.outfits.find((o) => o.id === id)?.garments.join();
      }, id);
      // Wait on the same public API queue before checking the rendered meshes.
      await page.evaluate(async () => { await window.__actors.character.set({}); window.__actors.character.seek(0.3); });
      await page.waitForTimeout(800);
      const result = await page.evaluate(() => {
        const { character } = window.__actors;
        const worn = character.config.outfit.filter((id) => id.startsWith("future-"));
        return worn.map((id) => {
          const mesh = character.actor.meshes.get(id);
          return { id, visible: !!mesh?.visible, vertices: mesh?.geometry.getAttribute("position").count, finite: Array.from(mesh?.geometry.getAttribute("position").array ?? []).every(Number.isFinite) };
        });
      });
      for (const piece of result) assert(piece.visible && piece.vertices > 0 && piece.finite, JSON.stringify(piece));
      assert(await page.locator('[data-role="outfit-description"]').innerText());
      await page.screenshot({ path: `${out}/${id}-${gender}.png` });
      report.push({ id, gender, pieces: result });
    }
  }
  await page.selectOption('select[data-role="outfit-preset"]', "future-festival");
  await page.evaluate(async () => { await window.__actors.character.set({}); });
  await page.evaluate(() => window.__actors.stage.view([-0.6, 1.3, -4.3], [0, 1, 0]));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/festival-back.png` });
  const screens = await page.evaluate(async () => {
    const c = window.__actors.character;
    const material = c.actor.meshes.get("future-screen").material;
    const before = Array.from(material.emissiveMap.image.data);
    c.actor.update(2);
    const changed = before.some((v, i) => v !== material.emissiveMap.image.data[i]);
    c.actor.setGarmentColor("future-screen", "#ff8800");
    const tint = material.emissive.getHexString();
    c.actor.setGarmentColor("future-screen", null);
    const restored = material.emissive.getHexString();
    const glb = await c.exportGlb("current");
    const length = new DataView(glb).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, length)));
    return { changed, tint, restored, bytes: glb.byteLength, emissiveTextures: json.materials.filter((m) => m.emissiveTexture).length, animations: json.animations?.length ?? 0 };
  });
  assert(screens.changed);
  assert.equal(screens.tint, "ff8800");
  assert.notEqual(screens.restored, screens.tint);
  assert(screens.emissiveTextures >= 3);
  assert(screens.animations > 0);
  await page.click('button[data-mode="simple"]');
  await page.selectOption('select[data-role="future-pants"]', "future-cocoon");
  await page.waitForFunction(() => window.__actors.character.config.outfit.includes("future-cocoon"));
  const pants = await page.evaluate(async () => {
    const c = window.__actors.character;
    await c.set({});
    const available = c.catalog.garments.filter((g) => g.category === "Future · pants");
    const keptTop = c.config.outfit.includes("future-screen");
    const selected = c.config.outfit.filter((id) => available.some((g) => g.id === id));
    for (const level of [1, 2, 0]) { c.setLod(level); c.actor.update(0); }
    return { count: available.length, keptTop, selected, visible: c.actor.meshes.get("future-cocoon").visible };
  });
  assert.equal(pants.count, 6);
  assert(pants.keptTop && pants.visible);
  assert.deepEqual(pants.selected, ["future-cocoon"]);
  writeFileSync(`${out}/report.json`, JSON.stringify({ url, backend, report, screens, pants, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ backend, outfits: report.length, screens, pants, errors }));
} finally {
  await browser.close();
}
