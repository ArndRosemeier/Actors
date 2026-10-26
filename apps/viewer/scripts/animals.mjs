// Headless check of an animal actor: every preset side-on, close-ups of
// head and coat, and frames of a few clips.
// Usage: node scripts/animals.mjs [url] [outDir]   (SHOTS=breed-,walk to pick)
// Squirrels: node scripts/animals.mjs "http://localhost:5173/animals.html?animal=squirrel" screenshots/squirrels
// Cats: node scripts/animals.mjs "http://localhost:5173/animals.html?animal=cat" screenshots/cats
// Deer: node scripts/animals.mjs "http://localhost:5173/animals.html?animal=deer" screenshots/deer
// Horses: node scripts/animals.mjs "http://localhost:5173/animals.html?animal=horse" screenshots/horses
// Cows: node scripts/animals.mjs "http://localhost:5173/animals.html?animal=cow" screenshots/cows
// Chickens: node scripts/animals.mjs "http://localhost:5173/animals.html?animal=chicken" screenshots/chickens
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
// Frames the animal by its current size (squirrels are about 0.3 of a dog, cats half, the deer about 1.35 times its height, a horse 2.6).
const kind = await page.evaluate(() => window.__actors.kind);
const H = kind === "squirrel" ? 0.3 : kind === "cat" ? 0.5 : kind === "deer" ? 1.35 : kind === "horse" ? 2.6 : kind === "cow" ? 2.4 : kind === "chicken" ? 0.45 : 1;
const size = () => page.evaluate((h) => window.__actors.animal.shape.size * h, H);
const side = async () => {
  const s = await size();
  await view([2.5 * s, 0.75 * s, 1.55 * s], [0, 0.38 * s, 0.05 * s]);
};
const head = async () => {
  const s = await size();
  if (kind === "squirrel") await view([0.9 * s, 0.7 * s, 1.7 * s], [0, 0.48 * s, 0.42 * s]);
  else if (kind === "deer") await view([0.55 * s, 0.82 * s, 0.85 * s], [0, 0.73 * s, 0.42 * s]);
  else if (kind === "cow") await view([0.42 * s, 0.5 * s, 1.0 * s], [0, 0.44 * s, 0.56 * s]);
  else if (kind === "chicken") await view([0.4 * s, 0.86 * s, 0.75 * s], [0, 0.8 * s, 0.33 * s]);
  else await view([0.7 * s, 0.82 * s, 1.25 * s], [0, 0.62 * s, 0.5 * s]);
};
const base = await page.evaluate(() => window.__actors.animal.species.base);
// Head close-ups: every squirrel, a few dogs and deer.
const closeUp = (id) => kind === "squirrel" || kind === "cat" || kind === "cow" || kind === "chicken" || (kind === "horse" && ["bay", "grey", "arabian"].includes(id)) || (kind === "deer" ? ["sika", "red", "whitetail"] : ["wolfdog", "germanShepherd", "labrador", "beagle", "husky"]).includes(id);
const clips = kind === "chicken" ? ["walk", "run", "peck", "scratch", "flap", "sit"] : kind === "cow" ? ["walk", "trot", "eat", "headbutt"] : kind === "horse" ? ["walk", "trot", "gallop", "rear"] : kind === "deer" ? ["walk", "gallop", "eat", "headbutt"] : kind === "squirrel" ? ["alert", "eat", "hop", "run", "flick", "walk"] : kind === "cat" ? ["walk", "run", "sit", "meow"] : ["walk", "run", "sit", "howl"];

// Still-shot times (seconds) for clips whose key moment is later: a chicken's beak on the ground, its wings open.
const poseAt = kind === "chicken" ? { peck: 0.8, flap: 0.75 } : {};
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
  if (want(`head-${id}`) && closeUp(id)) {
    await head();
    await shot(`head-${id}`);
  }
}
await call("setBreed", base);
if ((kind === "horse" || kind === "cow") && want("tack")) {
  // Saddle and bridle (the rider needs the human pack: RIDER=1).
  await call("setTack", true);
  if (process.env.RIDER) await call("setRider", true);
  await side();
  await shot("tack");
}
for (const clip of clips) {
  if (!want(clip)) continue;
  await call("play", clip);
  await call("pose", poseAt[clip] ?? 0.3);
  await side();
  await shot(`clip-${clip}`);
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors", `(${Math.round((Date.now() - t0) / 1000)} s)`);
await browser.close();
if (errors.length) process.exit(1);
