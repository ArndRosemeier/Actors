// Headless close-ups of skin: face front and three-quarter, shoulder and arm, hand, for photo and
// procedural skin on a few bodies. Usage: node scripts/skin.mjs [url] [outDir]   (url may carry ?webgpu)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/skin"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
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
await page.evaluate(() => window.__actors.stage.renderer.setAnimationLoop(null));
const draw = () => page.evaluate(() => { const { stage } = window.__actors; stage.controls.update(); stage.renderer.render(stage.scene, stage.camera); });

const people = (process.env.PEOPLE ?? "f-cauc,m-afr,f-asian").split(",");
const bodies = {
  "f-cauc": { gender: 0.05, age: 0.5, caucasian: 1, african: 0, asian: 0 },
  "m-afr": { gender: 1, age: 0.5, caucasian: 0, african: 1, asian: 0 },
  "f-asian": { gender: 0.05, age: 0.5, caucasian: 0, african: 0, asian: 1 },
  "m-old": { gender: 1, age: 0.9, caucasian: 1, african: 0, asian: 0 },
};
const details = (process.env.DETAIL ?? "1,0").split(",").map((d) => d === "1");
for (const detail of details)
for (const who of people) {
  for (const skin of (process.env.SKINS ?? "photo,procedural").split(",")) {
    await page.evaluate(async ({ body, skin, detail }) => {
      const { character } = window.__actors;
      await character.set({ animation: null, outfit: ["briefs"], skin, expression: "neutral", body, skinDetail: detail });
      for (let i = 0; i < 5; i++) character.update(1 / 60);
      await new Promise((r) => setTimeout(r, 1000));
    }, { body: bodies[who], skin, detail });
    const h = await page.evaluate(() => window.__actors.character.height);
    const k = h / 1.7, eye = h - 0.12 * k;
    const views = {
      face: [[0, eye, 0.45 * k], [0, eye - 0.03 * k, 0]],
      face34: [[0.32 * k, eye, 0.32 * k], [0, eye - 0.03 * k, 0]],
      shoulder: [[0.45 * k, h * 0.8, 0.45 * k], [0.15 * k, h * 0.76, 0]],
      torso: [[0.2 * k, h * 0.65, 0.9 * k], [0, h * 0.65, 0]],
    };
    for (const [name, [cam, at]] of Object.entries(views)) {
      await page.evaluate(({ cam, at }) => window.__actors.stage.view(cam, at), { cam, at });
      await draw();
      await page.screenshot({ path: `${out}/${who}-${skin}-${name}${detail ? "" : "-plain"}.png`, clip: { x: 320, y: 0, width: 680, height: 700 } });
    }
  }
}
console.log("errors:", errors.length ? errors.slice(0, 5).join("\n") : "none");
await browser.close();
