// Headless check of cloth motion (clothMotion): loose garments while the character runs, stops and
// spins, seen from the side, with the same frames with clothMotion off for comparison.
// Usage: node scripts/sway.mjs [url] [outDir]   (url may carry ?webgpu); env OUTFITS=evening,long-skirt
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/sway"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outfits = (process.env.OUTFITS ?? "evening,long-skirt,medieval,wizard").split(",");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });
// Frames are stepped and drawn by the script only: the page's own loop would keep moving the cloth while a shot is taken.
await page.evaluate(() => window.__actors.stage.renderer.setAnimationLoop(null));
const draw = () => page.evaluate(() => { const { stage } = window.__actors; stage.controls.update(); stage.renderer.render(stage.scene, stage.camera); });

// Moves the character by script (no root motion in the clips): `path(t)` gives [z, yaw] at time t.
const play = (seconds, path) =>
  page.evaluate(({ seconds, path }) => {
    const { character } = window.__actors;
    const f = new Function("t", `return (${path})(t)`);
    const steps = Math.round(seconds * 60);
    for (let i = 1; i <= steps; i++) {
      const [z, yaw] = f(window.__swayT += 1 / 60);
      character.object.position.set(0, 0, z);
      character.object.rotation.y = yaw;
      character.update(1 / 60);
    }
    const s = character.actor.clothSway;
    return { tilt: [s.tilt.x, s.tilt.y].map((v) => +v.toFixed(3)), twist: +s.twist.toFixed(3) };
  }, { seconds, path: path.toString() });

const run = (t) => [t < 1.2 ? 3 * t * t / 2.4 * (t < 0 ? 0 : 1) : 3 * 0.6 + 3 * (t - 1.2), 0];
for (const outfit of outfits) {
  for (const motion of [true, false]) {
    await page.evaluate(async ({ outfit, motion }) => {
      const { character } = window.__actors;
      await character.set({ animation: "idle", clothMotion: motion, body: { gender: 0.05 } });
      await character.wear(outfit);
      for (let i = 0; i < 10; i++) character.update(1 / 60);
      await new Promise((r) => setTimeout(r, 1500)); // garment files and textures arrive
      character.object.position.set(0, 0, 0);
      character.object.rotation.y = 0;
      character.actor.clothSway.reset();
      window.__swayT = 0;
    }, { outfit, motion });
    const shot = async (name, z) => {
      await page.evaluate(({ z }) => {
        const { stage, character } = window.__actors;
        const h = character.height;
        stage.view([4.2, h * 0.3, z], [0, h * 0.22, z]);
      }, { z });
      await draw();
      await page.screenshot({ path: `${out}/${outfit}-${name}${motion ? "" : "-off"}.png`, clip: { x: 480, y: 0, width: 520, height: 700 } });
    };
    // Accelerate to 3 m/s over 1.2 s, run, then stop dead at 2 s.
    await play(2, run);
    const zRun = await page.evaluate(() => window.__actors.character.object.position.z);
    await shot("running", zRun);
    const zStop = zRun;
    const at = [];
    for (const [name, secs] of [["stop-0.25s", 0.25], ["stop-0.6s", 0.35], ["stop-2s", 1.4]]) {
      at.push(await play(secs, () => [Number(window.__actors.character.object.position.z), 0]));
      await shot(name, zStop);
    }
    // A quick spin on the spot (a full turn in 0.8 s), shot mid-turn from the front.
    await page.evaluate(() => (window.__spinStart = window.__swayT));
    const spin = await play(0.4, () => [Number(window.__actors.character.object.position.z), Math.min((window.__swayT - window.__spinStart) / 0.8, 1) * Math.PI * 2]);
    await page.evaluate(({ z }) => {
      const { stage, character } = window.__actors;
      const h = character.height;
      stage.view([0, h * 0.3, z + 4.2], [0, h * 0.22, z]);
    }, { z: zStop });
    await draw();
    await page.screenshot({ path: `${out}/${outfit}-spin${motion ? "" : "-off"}.png`, clip: { x: 480, y: 0, width: 520, height: 700 } });
    console.log(outfit, motion ? "on " : "off", JSON.stringify(at), "spin", JSON.stringify(spin));
  }
}
console.log("errors:", errors.length ? errors.slice(0, 5).join("\n") : "none");
await browser.close();
