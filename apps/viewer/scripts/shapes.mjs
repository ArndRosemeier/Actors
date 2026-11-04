// Headless full-body shots of the body types (front and side), for women and men.
// Usage: node scripts/shapes.mjs [url] [outDir]   env TYPES=slim,curvy  PEOPLE=f,m
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:5173/", out = "screenshots/shapes"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
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

const types = (process.env.TYPES ?? "average,athletic,curvy,heavy").split(",");
const people = { f: 0.05, m: 1 };
for (const who of (process.env.PEOPLE ?? "f,m").split(","))
for (const type of types) {
  const ok = await page.evaluate(async ({ type, gender }) => {
    const { character } = window.__actors;
    // The editor's own "Body type" select, so the shot goes through the UI path.
    await character.set({ animation: null, outfit: ["briefs"], expression: "neutral", body: { gender, ageYears: 30 } });
    const sel = document.querySelector('select[data-key="bodyType"]') ?? [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "hourglass"));
    if (!sel) return false;
    sel.value = type;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 5; i++) character.update(1 / 60);
    return true;
  }, { type, gender: people[who] });
  if (!ok) { errors.push("no body type select"); break; }
  const h = await page.evaluate(() => window.__actors.character.height);
  for (const [name, cam] of Object.entries({ front: [0, h * 0.55, h * 2], side: [h * 2, h * 0.55, 0] })) {
    await page.evaluate(({ cam, at }) => window.__actors.stage.view(cam, at), { cam, at: [0, h * 0.5, 0] });
    await draw();
    await page.screenshot({ path: `${out}/${who}-${type}-${name}.png`, clip: { x: 320, y: 0, width: 680, height: 700 } });
  }
}
console.log("errors:", errors.length ? errors.slice(0, 5).join("\n") : "none");
await browser.close();
