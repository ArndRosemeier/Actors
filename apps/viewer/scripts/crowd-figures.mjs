// Crowd figures check: opens crowd.html on WebGPU (SwiftShader Vulkan in the cloud, a real GPU elsewhere),
// waits for the measured frames and prints the page's numbers (memory, frame cost, draw calls) as JSON.
// Fails on WebGPU errors. Saves a canvas capture.
// Usage: node scripts/crowd-figures.mjs ["http://localhost:5173/crowd.html?compare"] [out.png] [--headed] [--init=<script>]
// Headless on a software GPU, WebGPU cannot present to a canvas: pass a stand-in swap chain with --init (Nauta's
// tools/shot/swapchain.js renders to a texture, paces requestAnimationFrame by the GPU and paints the last frame
// on window.__presentWebGPU()). On a machine with a GPU, use --headed and leave --init out.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const [url = "http://localhost:5173/crowd.html?compare", out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const headed = process.argv.includes("--headed");
const browser = await chromium.launch({
  headless: !headed,
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: headed
    ? ["--enable-unsafe-webgpu", "--enable-precise-memory-info"]
    : ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--use-gl=angle", "--ignore-gpu-blocklist", "--enable-precise-memory-info"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const init = process.argv.find((a) => a.startsWith("--init="))?.slice(7);
if (init) await page.addInitScript({ path: init });
await page.addInitScript(() => {
  // Chromium 141 rejects three's `swizzle` in createView; drop it.
  const view = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (d) {
    if (d && "swizzle" in d) { d = { ...d }; delete d.swizzle; }
    return view.call(this, d);
  };
});
const errors = [];
const benign = /experimental on this platform|PCFSoftShadowMap|timestamp/i;
page.on("console", (m) => {
  const t = m.text();
  if (benign.test(t)) return;
  if (m.type() === "error" || /GPUValidation|WebGPU/i.test(t)) errors.push(t);
  else if (process.argv.includes("--verbose")) console.error(t);
});
page.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__crowd?.ready || window.__crowdError, null, { timeout: 900000, polling: 1000 });
const result = await page.evaluate(() => ({ ...window.__crowd, error: window.__crowdError }));
result.wallSeconds = Math.round((Date.now() - t0) / 1000);
console.log(JSON.stringify(result, null, 2));
if (out) {
  if (init) {
    await page.evaluate(() => window.__presentWebGPU?.());
    await page.screenshot({ path: out });
  } else {
    // Drawn and read in one task: the WebGPU canvas is only readable until the frame is presented.
    const png = await page.evaluate(() => {
      const { renderer, scene, camera } = window.__actors;
      renderer.render(scene, camera);
      return document.querySelector("canvas").toDataURL("image/png");
    });
    writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
  }
  console.error(`saved ${out}`);
}
await browser.close();
if (errors.length) {
  console.error(`${errors.length} errors:\n${[...new Set(errors)].slice(0, 20).join("\n")}`);
  process.exit(1);
}
