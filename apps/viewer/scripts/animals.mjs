// Headless check of the dog actor: every breed preset side-on, close-ups of
// head and coat, and frames of a few clips.
// Usage: node scripts/animals.mjs [url] [outDir]   (SHOTS=breed-,walk to pick)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const [url = "http://localhost:5173/animals.html", out = "screenshots/animals"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1320, height: 780 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });

const only = process.env.SHOTS?.split(",");
const want = (name) => !only || only.some((o) => name.startsWith(o));
const call = (fn, ...args) => page.evaluate(([f, a]) => window.__actors[f](...a), [fn, args]);
const view = (pos, target) => page.evaluate(([p, t]) => window.__actors.stage.view(p, t), [pos, target]);
const shot = async (name, wait = 500) => {
  await page.waitForTimeout(wait);
  // The canvas keeps its drawing buffer; reading it skips Playwright's wait for a stable page (slow software GL).
  const png = await page.evaluate(async () => {
    // Wait for two fresh frames so the shot shows the latest state.
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
    return window.__actors.stage.screenshot();
  });
  writeFileSync(`${out}/${name}.png`, Buffer.from(png.split(",")[1], "base64"));
  console.log("saved", name);
};
// Frames the dog by its current size.
const size = () => page.evaluate(() => window.__actors.animal.shape.size);
const side = async () => {
  const s = await size();
  await view([2.5 * s, 0.75 * s, 1.55 * s], [0, 0.38 * s, 0.05 * s]);
};
const head = async () => {
  const s = await size();
  await view([0.7 * s, 0.82 * s, 1.25 * s], [0, 0.62 * s, 0.5 * s]);
};

const t0 = Date.now();
const ms = await page.evaluate(async () => {
  const a = window.__actors;
  const t = performance.now();
  a.animal.shape.legs = 1.01;
  await a.refresh();
  return performance.now() - t;
});
console.log("shape update", Math.round(ms), "ms");

await call("play", null);
const breeds = await page.evaluate(() => [...document.querySelectorAll("#breed option")].map((o) => o.value).filter((v) => v !== "custom"));
for (const id of breeds) {
  if (!want(`breed-${id}`)) continue;
  await call("setBreed", id);
  await side();
  await shot(`breed-${id}`);
  if (want(`head-${id}`) && ["wolfdog", "germanShepherd", "labrador", "beagle", "husky"].includes(id)) {
    await head();
    await shot(`head-${id}`);
  }
}
await call("setBreed", "wolfdog");
for (const clip of ["walk", "run", "sit", "howl"]) {
  if (!want(clip)) continue;
  await call("play", clip);
  await call("pose", 0.3);
  await side();
  await shot(`clip-${clip}`);
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors", `(${Math.round((Date.now() - t0) / 1000)} s)`);
await browser.close();
if (errors.length) process.exit(1);
