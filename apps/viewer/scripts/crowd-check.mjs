// Crowd cost check: the viewer's ?crowd=N characters at a fixed level, draw calls and triangles per
// frame (shadow pass included) with the cost controls on and off, and a screenshot of each.
// Usage: node scripts/crowd-check.mjs ["http://localhost:5173/?crowd=24"] [out-prefix] [--level=2]
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const [url = "http://localhost:5173/?crowd=24", out = "crowd"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const level = Number(process.argv.find((a) => a.startsWith("--level="))?.slice(8) ?? 2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--disable-vulkan-surface"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 900000 });

const measure = (name, on) =>
  page.evaluate(
    async ({ on, level }) => {
      const { character, crowd, stage } = window.__actors;
      for (const c of [character, ...crowd]) {
        c.setLod(level);
        const a = c.actor;
        a.crowdHair = on;
        a.mergeOutfitFrom = on ? 1 : Infinity;
        a.smallPartShadows = !on;
        a.frustumCulling = on;
        a.animationSteps = on ? undefined : [];
        a.offscreenStep = on ? 4 : 1;
      }
      stage.camera.position.set(0, 3, 9);
      stage.controls.target.set(0, 0.9, -4);
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      for (let i = 0; i < 20; i++) await frame();
      const info = stage.renderer.info.render;
      const t0 = performance.now();
      let updates = 0;
      for (const c of crowd) {
        const s = performance.now();
        c.update(1 / 60);
        updates += performance.now() - s;
      }
      return { calls: info.calls ?? info.drawCalls, triangles: info.triangles, meshes: crowd.reduce((n, c) => { let k = 0; c.object.traverse((o) => o.isMesh && o.visible && k++); return n + k; }, 0), crowd: crowd.length, updateMs: +(updates).toFixed(2), took: +(performance.now() - t0).toFixed(1) };
    },
    { on, level },
  ).then(async (r) => {
    // A canvas capture right after a render (page screenshots of a WebGPU canvas come out blank).
    const png = await page.evaluate(() => {
      const { stage } = window.__actors;
      stage.renderer.render(stage.scene, stage.camera);
      return document.querySelector("canvas").toDataURL("image/png");
    });
    writeFileSync(`${out}-${name}.png`, Buffer.from(png.split(",")[1], "base64"));
    console.log(name, JSON.stringify(r));
  });

await measure("before", false);
await measure("after", true);
if (errors.length) console.error("errors:\n" + errors.join("\n"));
await browser.close();
