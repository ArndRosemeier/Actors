// Finds clothing poke-through automatically: renders every outfit preset in demanding poses with each
// mesh in its own flat colour (skinned and cut exactly as drawn), then looks for small islands of one
// mesh enclosed by a garment (skin through a shirt, a waistband through a sweater, hair through a hood).
// Usage: node scripts/clipping.mjs [url] [outDir] [--quick]   (WebGL only; dev server must be running)
// Writes report.json and a marked image per finding; prints a summary by garment pair.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const [url = "http://localhost:5173/", out = "screenshots/clipping"] = args.filter((a) => !a.startsWith("--"));
const quick = args.includes("--quick");
mkdirSync(out, { recursive: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const W = 480, H = 640;
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__actors?.ready, null, { timeout: 180000 });

// Poses: clip, normalized time. Chosen to bend hips, knees, elbows, shoulders and the spine.
const POSES = quick
  ? [["walk", 0.3], ["sit", 0.5], ["crouch", 0.5]]
  : [["walk", 0.3], ["sprint", 0.4], ["sit", 0.5], ["crouch", 0.5], ["jump", 0.4], ["pick up", 0.5], ["repair (kneeling)", 0.5], ["sword slash A", 0.5], ["dance", 0.3], ["arms folded", 0.5], ["spell raise", 0.6], ["roll", 0.4]];
const VIEWS = [[0.9, 1.0, 3.0], [-2.6, 1.0, 1.6], [0.3, 1.1, -3.0]];

await page.evaluate(async ({ root, W, H }) => {
  const threeUrl = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/.vite/deps/three.js"));
  const THREE = await import(threeUrl);
  const A = await import(`/@fs${root}/packages/three/src/index.ts`);
  const { character, stage } = window.__actors;
  const target = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
  window.__clip = { THREE, A, target, cam };
  await character.set({ hair: "hair-short02", expression: "neutral", blink: false });
  stage.renderer.setAnimationLoop?.(null);
  // Flat id colours: index i -> rgb.
  window.__clip.idColor = (i) => new THREE.Color(((i * 67) % 251) / 255, ((i * 131 + 40) % 241) / 255, ((i * 29 + 90) % 233) / 255);
  window.__clip.shade = (pos, look) => {
    cam.position.set(...pos);
    cam.lookAt(...look);
    cam.updateMatrixWorld();
    const r = stage.renderer;
    r.setRenderTarget(target);
    r.render(stage.scene, cam);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(target, 0, 0, W, H, px);
    r.setRenderTarget(null);
    const out = new Uint8Array(W * H * 3);
    for (let p = 0; p < W * H; p++) {
      const q = (H - 1 - Math.floor(p / W)) * W + (p % W);
      out.set(px.subarray(p * 4, p * 4 + 3), q * 3);
    }
    return Array.from(out);
  };
  window.__clip.render = (pos, look) => {
    const { actor } = character;
    const meshes = [...actor.meshes.values(), ...actor.parts.values()].filter((m) => m.visible);
    const saved = meshes.map((m) => m.material);
    const names = [];
    meshes.forEach((m, i) => {
      const src = Array.isArray(m.material) ? m.material[0] : m.material;
      let mat = new THREE.MeshBasicMaterial({ color: window.__clip.idColor(i + 1), side: src.side, alphaTest: src.alphaTest, map: src.alphaTest > 0 ? src.map : null });
      mat.polygonOffset = src.polygonOffset;
      mat.polygonOffsetFactor = src.polygonOffsetFactor;
      mat.polygonOffsetUnits = src.polygonOffsetUnits;
      // Cut-outs (hair cards, lace) keep the map's alpha but not its colour.
      if (mat.map) mat.onBeforeCompile = (sh) => (sh.fragmentShader = sh.fragmentShader.replace("#include <alphatest_fragment>", "#include <alphatest_fragment>\ndiffuseColor.rgb = diffuse;"));
      if (m.geometry.getAttribute("clipValue")) mat = A.useClipAttribute(mat);
      if (/colliders/.test(src.customProgramCacheKey?.() ?? "")) mat = A.useColliders(mat, actor.colliders);
      m.material = A.useDualQuaternionSkinning(mat);
      names.push(m.name);
    });
    const bg = stage.scene.background, env = stage.scene.environment;
    const hidden = [];
    stage.scene.traverse((o) => {
      if ((o.isMesh || o.isPoints || o.isLine) && !meshes.includes(o) && o.visible) {
        hidden.push(o);
        o.visible = false;
      }
    });
    stage.scene.background = new THREE.Color(0, 0, 0);
    cam.position.set(...pos);
    cam.lookAt(...look);
    cam.updateMatrixWorld();
    const r = stage.renderer;
    const tm = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(target);
    r.render(stage.scene, cam);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(target, 0, 0, W, H, px);
    r.setRenderTarget(null);
    r.toneMapping = tm;
    stage.scene.background = bg;
    stage.scene.environment = env;
    for (const o of hidden) o.visible = true;
    meshes.forEach((m, i) => {
      m.material.dispose();
      m.material = saved[i];
    });
    // Pixel -> mesh index (nearest id colour; textured cut-outs are tinted by their map).
    const ids = names.map((_, i) => window.__clip.idColor(i + 1)).map((c) => [c.r * 255, c.g * 255, c.b * 255]);
    const lab = new Int16Array(W * H).fill(-1);
    for (let p = 0; p < W * H; p++) {
      const R = px[p * 4], G = px[p * 4 + 1], B = px[p * 4 + 2];
      if (R + G + B < 6) continue;
      let best = 0, bd = Infinity;
      for (let k = 0; k < ids.length; k++) {
        const d = (ids[k][0] - R) ** 2 + (ids[k][1] - G) ** 2 + (ids[k][2] - B) ** 2;
        if (d < bd) (bd = d), (best = k);
      }
      lab[(H - 1 - Math.floor(p / W)) * W + (p % W)] = best; // flip rows: top first
    }
    return { names, lab: Array.from(lab) };
  };
}, { root, W, H });

/** Islands of one mesh enclosed by a garment: [{ inside, around, area, x, y }]. */
function islands(lab, names, garments) {
  const seen = new Uint8Array(W * H), found = [];
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || lab[s] < 0) continue;
    const id = lab[s], stack = [s], pix = [];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      pix.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!seen[q] && lab[q] === id) (seen[q] = 1), stack.push(q);
      }
    }
    if (pix.length < 4 || pix.length > 1500) continue;
    // The ring around the island: who encloses it?
    const ring = new Map();
    let total = 0;
    for (const p of pix) {
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const l = lab[ny * W + nx];
        if (l === id) continue;
        total++;
        ring.set(l, (ring.get(l) ?? 0) + 1);
      }
    }
    const [around, n] = [...ring].sort((a, b) => b[1] - a[1])[0] ?? [-1, 0];
    if (around < 0 || n / total < 0.85 || !garments.has(names[around])) continue;
    let sx = 0, sy = 0;
    for (const p of pix) (sx += p % W), (sy += (p / W) | 0);
    found.push({ inside: names[id], around: names[around], area: pix.length, x: Math.round(sx / pix.length), y: Math.round(sy / pix.length) });
  }
  return found;
}

const outfits = await page.evaluate(() => window.__actors.character.catalog.outfits.map((o) => o.id));
const list = process.env.OUTFITS ? process.env.OUTFITS.split(",") : outfits.filter((o) => o !== "nude");
const report = [];
for (const [g, gender] of [["f", 0.1], ["m", 0.9]]) {
  await page.evaluate(async (gender) => window.__actors.character.set({ body: { gender, ageYears: 30, muscle: 0.5, weight: 0.5 }, details: {} }), gender);
  for (const outfit of list) {
    await page.evaluate((id) => window.__actors.character.wear(id), outfit);
    const garments = new Set(await page.evaluate(() => window.__actors.character.config.outfit));
    for (const [clip, at] of POSES) {
      await page.evaluate(async ({ clip, at }) => {
        const { character } = window.__actors;
        await character.set({ animation: clip });
        const d = character.actor.currentAction?.getClip().duration ?? 1;
        character.seek(d * at);
        character.update(0);
      }, { clip, at });
      for (let v = 0; v < VIEWS.length; v++) {
        const { names, lab } = await page.evaluate(({ pos }) => window.__clip.render(pos, [0, 0.85, 0]), { pos: VIEWS[v] });
        const found = islands(lab, names, garments); // garment ids are their mesh names
        for (const f of found) report.push({ gender: g, outfit, clip, at, view: v, ...f });
        if (process.env.DUMP_LABELS) {
          const { PNG } = await import("pngjs");
          const png = new PNG({ width: W * 2, height: H });
          const shaded = await page.evaluate(({ pos }) => window.__clip.shade(pos, [0, 0.85, 0]), { pos: VIEWS[v] });
          for (let p = 0; p < W * H; p++) {
            const l = lab[p];
            const c = l < 0 ? [0, 0, 0] : [(l * 67) % 251, (l * 131 + 40) % 241, (l * 29 + 90) % 233];
            const x = p % W, y = (p / W) | 0;
            png.data.set([...c, 255], (y * W * 2 + x) * 4);
            png.data.set([shaded[p * 3], shaded[p * 3 + 1], shaded[p * 3 + 2], 255], (y * W * 2 + x + W) * 4);
          }
          for (const f of found) for (let d = -6; d <= 6; d++) for (const [x, y] of [[f.x + d, f.y - 6], [f.x + d, f.y + 6], [f.x - 6, f.y + d], [f.x + 6, f.y + d]]) if (x >= 0 && y >= 0 && x < W && y < H) png.data.set([255, 0, 0, 255], (y * W * 2 + x) * 4);
          writeFileSync(`${out}/${g}-${outfit}-${clip.replace(/[^a-z]/g, "")}-${v}.png`, PNG.sync.write(png));
        }
      }
    }
    const mine = report.filter((r) => r.outfit === outfit && r.gender === g);
    console.log(`${g} ${outfit}: ${mine.length} islands`);
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
const pairs = new Map();
for (const r of report) pairs.set(`${r.inside} -> ${r.around}`, (pairs.get(`${r.inside} -> ${r.around}`) ?? 0) + 1);
console.log("\nBy pair (inside -> around):");
for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${k}`);
if (errors.length) console.log("errors:", errors);
await browser.close();
