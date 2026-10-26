// Real-WebGPU check: opens a viewer page on WebGPU (SwiftShader Vulkan), records
// every render pipeline's vertex buffer count, and fails on WebGPU errors or
// on any pipeline over the device limit. Saves a canvas capture.
// Usage: node scripts/webgpu-check.mjs <url with ?webgpu> [out.png] [--human]
// Animals: node scripts/webgpu-check.mjs "http://localhost:5173/webgpu-animals.html?animals=dog,cat,squirrel,deer"
// With the fur materials and shells: add &fur (e.g. "...webgpu-animals.html?animals=chicken&fur").
// --human drives the character viewer: every race, smiling, dressed, with hair
// (face morphs, generated add-ons and garments all get drawn).
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const [url = "http://localhost:5173/?webgpu", out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const human = process.argv.includes("--human");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--disable-vulkan-surface", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  window.__gpu = { pipelines: 0, maxBuffers: 0, over: [], limit: 0, backend: "none", counts: {} };
  // Chromium 141 rejects three's `swizzle` in createView; drop it.
  const view = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (d) {
    if (d && "swizzle" in d) { d = { ...d }; delete d.swizzle; }
    return view.call(this, d);
  };
  const wrap = (name) => {
    const f = GPUDevice.prototype[name];
    GPUDevice.prototype[name] = function (d) {
      const n = d.vertex?.buffers?.length ?? 0;
      window.__gpu.backend = "webgpu";
      window.__gpu.limit = this.limits.maxVertexBuffers;
      window.__gpu.pipelines++;
      window.__gpu.counts[n] = (window.__gpu.counts[n] ?? 0) + 1;
      window.__gpu.maxBuffers = Math.max(window.__gpu.maxBuffers, n);
      if (n > this.limits.maxVertexBuffers) window.__gpu.over.push(`${d.label ?? "?"}: ${n}`);
      return f.call(this, d);
    };
  };
  wrap("createRenderPipeline");
  wrap("createRenderPipelineAsync");
});
const errors = [];
const benign = /experimental on this platform|PCFSoftShadowMap/;
page.on("console", (m) => {
  const t = m.text();
  if (benign.test(t)) return;
  if (m.type() === "error" || /WebGPU|GPUValidation|vertex buffer/i.test(t)) errors.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${t}`);
});
const t0 = Date.now();
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 300000 });
console.error(`ready after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.waitForTimeout(3000);
if (human) {
  const races = await page.evaluate(() => window.__actors.character.catalog.races.map((r) => r.id));
  for (const race of races) {
    await page.evaluate(async (race) => {
      const { character } = window.__actors;
      await character.setRace(race);
      await character.set({ expression: "smile", outfit: "casual", hair: "hair-long01", animation: "walk" });
    }, race);
    await page.waitForTimeout(1500);
    console.error(`race ${race}: max ${await page.evaluate(() => window.__gpu.maxBuffers)} vertex buffers`);
  }
  // End on a smiling drakeborn (horns, tail, face morphs), framed whole.
  await page.evaluate(async () => {
    const { character, stage } = window.__actors;
    await character.setRace("drakeborn");
    await character.set({ expression: "smile", animation: null });
    stage.view([0.9, 1.3, 3.2], [0, 0.95, 0]);
  });
}
await page.waitForTimeout(5000);
const gpu = await page.evaluate(() => window.__gpu);
if (out) {
  const png = await page.evaluate(() => {
    const { stage } = window.__actors;
    const r = stage.renderer ?? stage.three?.renderer;
    if (r && stage.scene && stage.camera) r.render(stage.scene, stage.camera);
    return document.querySelector("canvas").toDataURL("image/png");
  });
  writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
}
console.log(JSON.stringify({ url, ...gpu, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
process.exit(gpu.backend !== "webgpu" || gpu.over.length || errors.length ? 1 : 0);
