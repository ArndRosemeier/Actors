import * as THREE from "three";

/** Small deterministic PRNG so generated textures are identical on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise with several octaves. */
function tileNoise(size: number, cells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const rand = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const grid = new Float32Array(n * n).map(() => rand());
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const g = (i: number, j: number) => grid[((j % n) * n + (i % n))];
        const v = (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
        out[y * size + x] += v * amp;
      }
    total += amp;
    amp *= 0.5;
  }
  return out.map((v) => v / total);
}

/** Converts a tileable height field into a tangent-space normal map. */
function heightToNormal(h: Float32Array, size: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x + size - 1) % size)], r = h[y * size + ((x + 1) % size)];
      const d = h[((y + size - 1) % size) * size + x], u = h[((y + 1) % size) * size + x];
      const nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let poreCache: THREE.DataTexture | undefined;
/** Skin micro-detail: pores (sparse pits) over fine bumpy noise. Tile it many times across the body UVs. */
export function poreNormalMap(): THREE.DataTexture {
  if (poreCache) return poreCache;
  const size = 512;
  const h = tileNoise(size, 32, 3, 7);
  const rand = rng(11);
  for (let p = 0; p < 2600; p++) {
    const cx = rand() * size, cy = rand() * size, r = 1 + rand() * 1.6, depth = 0.25 + rand() * 0.35;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        const x = (Math.floor(cx) + dx + size) % size, y = (Math.floor(cy) + dy + size) % size;
        h[y * size + x] -= depth * (1 - d * d);
      }
  }
  return (poreCache = heightToNormal(h, size, 3));
}

const fabricCache = new Map<string, THREE.DataTexture>();
/** Weave/knit normal maps for garments. */
export function fabricNormalMap(kind: string): THREE.DataTexture {
  if (fabricCache.has(kind)) return fabricCache.get(kind)!;
  const size = 256;
  const h = new Float32Array(size * size);
  const noise = tileNoise(size, 16, 2, 5);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
      let value: number;
      if (kind === "denim") {
        // 3/1 twill: diagonal ribs.
        value = 0.5 + 0.5 * Math.sin((x + y) * ((Math.PI * 2 * 24) / size));
      } else if (kind === "knit") {
        // Stocking stitch: columns of little V loops.
        value = Math.abs(Math.sin(u * 32)) * (0.6 + 0.4 * Math.abs(Math.sin(v * 48 + Math.sin(u * 32) * 1.5)));
      } else if (kind === "lace") {
        value = 0.5 + 0.5 * Math.sin(u * 20) * Math.sin(v * 20);
      } else {
        value = 0.5;
      }
      h[y * size + x] = value * 0.8 + noise[y * size + x] * 0.2;
    }
  const tex = heightToNormal(h, size, kind === "smooth" ? 1 : 4);
  fabricCache.set(kind, tex);
  return tex;
}

let lashCache: THREE.DataTexture | undefined;
/**
 * Alpha for the eyelash strips (u along the lid). Matches the importer's
 * normalized lash UVs: v 0..0.34 = upper lashes (root at v=0), v 0.69..1 =
 * lower lashes (root at v=1). Dense dark roots, tapered strands, sparse tips.
 */
export function lashAlphaMap(): THREE.DataTexture {
  if (lashCache) return lashCache;
  const w = 512, h = 128;
  const alpha = new Float32Array(w * h);
  const rand = rng(3);
  const strip = (v0: number, v1: number, count: number, maxLen: number, width: number) => {
    // Rows from root (v0) toward tip (v1).
    const rows = Math.round(Math.abs(v1 - v0) * h);
    const dir = Math.sign(v1 - v0);
    for (let s = 0; s < count; s++) {
      const x0 = rand() * w, len = maxLen * (0.5 + rand() * 0.5), bend = (rand() - 0.5) * 6;
      for (let r = 0; r < rows * len; r++) {
        const t = r / (rows * len);
        const y = Math.round(v0 * (h - 1)) + dir * r;
        if (y < 0 || y >= h) continue;
        const cx = x0 + bend * t * t;
        const half = width * (1 - 0.8 * t);
        for (let x = Math.floor(cx - 3); x <= Math.ceil(cx + 3); x++) {
          const a = Math.max(0, 1 - Math.abs(x - cx) / half) * (1 - 0.3 * t);
          const i = y * w + ((x + w) % w);
          alpha[i] = Math.max(alpha[i], a);
        }
      }
    }
    // Root line along the lid margin.
    for (let r = 0; r < Math.max(2, rows * 0.12); r++) {
      const y = Math.round(v0 * (h - 1)) + dir * r;
      for (let x = 0; x < w; x++) alpha[y * w + x] = 1;
    }
  };
  strip(0, 0.34, 420, 1, 1.4);
  strip(1, 0.69, 180, 0.7, 1.1);
  const data = new Uint8Array(w * h * 4);
  // alphaMap reads the green channel; fill all channels.
  for (let i = 0; i < w * h; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = data[i * 4 + 3] = Math.round(alpha[i] * 255);
  const tex = new THREE.DataTexture(data, w, h);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return (lashCache = tex);
}
