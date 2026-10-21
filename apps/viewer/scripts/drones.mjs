// Headless shots of generated drones: a gallery, one close-up per role, clips and the optional weapons.
// Usage: node scripts/drones.mjs [url] [outDir]   (SHOTS=gallery,role-,clip- to pick)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const [url = "http://localhost:5173/drones.html", out = "screenshots/drones"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
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
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 120000 });

const only = process.env.SHOTS?.split(",");
const want = (name) => !only || only.some((o) => name.startsWith(o));
const call = (fn, ...args) => page.evaluate(([f, a]) => window.__actors[f](...a), [fn, args]);
const shot = async (name, wait = 300) => {
  await page.waitForTimeout(wait);
  const png = await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
    return window.__actors.stage.screenshot();
  });
  writeFileSync(`${out}/${name}.png`, Buffer.from(png.split(",")[1], "base64"));
  console.log("saved", name);
};
const t0 = Date.now();
const SEEDS = (process.env.SEEDS ?? "11,12").split(",").map(Number);

if (want("gallery")) {
  await call("gallery", 16, false);
  await call("pose", 0.7);
  await shot("gallery", 800);
}
if (want("armed")) {
  await call("gallery", 8, true);
  await call("pose", 0.7);
  await shot("gallery-armed", 800);
}
for (const arch of ["scout", "courier", "sentinel", "surveyor", "worker", "interceptor", "lifter", "manta"]) {
  for (const seed of SEEDS) {
    const name = `role-${arch}-${seed}`;
    if (!want(name)) continue;
    const info = await call("set", { seed, archetype: arch, armed: false });
    await call("play", "hover");
    await call("pose", 0.6);
    await shot(name);
    console.log("  ", info.name, info.triangles, info.clips.join(","));
  }
}
for (const clip of ["cruise", "scan", "land", "work", "attack"]) {
  if (!want(`clip-${clip}`)) continue;
  const arch = clip === "work" ? "worker" : clip === "attack" ? "interceptor" : clip === "land" ? "courier" : "scout";
  await call("set", { seed: 11, archetype: arch, armed: clip === "attack" });
  await call("play", clip);
  await call("pose", 1.1);
  if (clip === "work") {
    // From below and in front, to see the arms and cargo.
    await page.evaluate(() => {
      const { min, max } = window.__actors.drones[0].model.bounds;
      const s = Math.max(max[0] - min[0], max[2] - min[2]);
      window.__actors.stage.view([s * 0.9, 0.35, s * 1.6], [0, (min[1] + max[1]) / 2 - 0.25, 0]);
    });
  }
  await shot(`clip-${clip}`);
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors", `(${Math.round((Date.now() - t0) / 1000)} s)`);
await browser.close();
if (errors.length) process.exit(1);
