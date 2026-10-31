import { readFileSync, writeFileSync } from "node:fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/** Single-channel float image (0..1), row 0 = top. */
export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

export function loadGray(path: string): Gray {
  const buf = readFileSync(path);
  const img = path.endsWith(".png") ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true });
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4] / 255;
  return { width: img.width, height: img.height, data };
}

export function resizeGray(src: Gray, size: number): Gray {
  const out = new Float32Array(size * size);
  const sx = src.width / size, sy = src.height / size;
  // Box filter (area average): masks are smooth, so this is enough.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let acc = 0, n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
          acc += src.data[yy * src.width + xx];
          n++;
        }
      out[y * size + x] = n ? acc / n : 0;
    }
  return { width: size, height: size, data: out };
}

export function blankGray(size: number): Gray {
  return { width: size, height: size, data: new Float32Array(size * size) };
}

export function maxGray(a: Gray, b: Gray): Gray {
  return { ...a, data: a.data.map((v, i) => Math.max(v, b.data[i])) };
}

/** Separable box blur, a few passes approximate a Gaussian. */
export function blurGray(img: Gray, radius: number, passes = 3): Gray {
  let cur = img.data;
  const { width: w, height: h } = img;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(cur.length);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -radius; x <= radius; x++) acc += cur[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * radius + 1);
        acc += cur[y * w + Math.min(w - 1, x + radius + 1)] - cur[y * w + Math.max(0, x - radius)];
      }
    }
    const out = new Float32Array(cur.length);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * radius + 1);
        acc += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
      }
    }
    cur = out;
  }
  return { ...img, data: cur };
}

/**
 * Rasterizes triangles given in OBJ UV space (v up) with a per-vertex value
 * into a mask (row 0 = top, i.e. v = 1).
 */
export function rasterizeUV(size: number, tris: { uv: [number, number][]; value: number[] }[]): Gray {
  const img = blankGray(size);
  for (const t of tris) {
    const p = t.uv.map(([u, v]) => [u * size, (1 - v) * size]);
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
        const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const v = w0 * t.value[0] + w1 * t.value[1] + w2 * t.value[2];
        img.data[y * size + x] = Math.max(img.data[y * size + x], v);
      }
  }
  return img;
}

/** Packs up to four gray masks into one RGBA PNG. */
export function writeRgbaPng(path: string, channels: (Gray | null)[]): void {
  const size = channels.find(Boolean)!.width;
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++)
    for (let c = 0; c < 4; c++) {
      const ch = channels[c];
      png.data[i * 4 + c] = ch ? Math.round(Math.min(1, Math.max(0, ch.data[i])) * 255) : c === 3 ? 255 : 0;
    }
  writeFileSync(path, PNG.sync.write(png));
}

/** Re-encodes a PNG/JPEG image as JPEG (alpha dropped). */
export function writeJpeg(srcPath: string, dstPath: string, quality = 88): void {
  const buf = readFileSync(srcPath);
  const img = srcPath.endsWith(".png") ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true });
  const data = Buffer.from(img.data);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  writeFileSync(dstPath, jpeg.encode({ data, width: img.width, height: img.height }, quality).data);
}

/**
 * Loads an RGBA image, halves it until it is at most `maxSize` wide, writes it
 * as PNG and returns the mean colour of its opaque pixels (0..1).
 */
/**
 * Writes a PNG at most `maxSize` wide (halving, alpha-weighted) and returns its
 * mean colour over opaque texels (averaged in linear light, returned as sRGB 0..1), or, with `sampleUVs` (u, v pairs,
 * OBJ convention), over the texels at those UVs, i.e. only the parts the mesh uses.
 */
export function writeRgbaDownsampled(srcPath: string, dstPath: string, maxSize: number, sampleUVs?: ArrayLike<number>): [number, number, number] {
  const buf = readFileSync(srcPath);
  let img: { width: number; height: number; data: Uint8Array } = srcPath.endsWith(".png") ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true });
  while (img.width > maxSize) {
    const w = img.width >> 1, h = img.height >> 1;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Alpha-weighted colour average so transparent texels don't darken edges.
        let a = 0, r = 0, g = 0, b = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const i = ((y * 2 + dy) * img.width + x * 2 + dx) * 4;
          const al = img.data[i + 3];
          a += al; r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al;
        }
        const o = (y * w + x) * 4;
        out[o] = a ? r / a : 0; out[o + 1] = a ? g / a : 0; out[o + 2] = a ? b / a : 0; out[o + 3] = a / 4;
      }
    img = { width: w, height: h, data: out };
  }
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  writeFileSync(dstPath, PNG.sync.write(png));
  return meanRgba(img, sampleUVs);
}

/** Mean colour of a PNG's opaque texels, as `writeRgbaDownsampled` returns it (optionally only at `sampleUVs`). */
export function meanPngColor(path: string, sampleUVs?: ArrayLike<number>): [number, number, number] {
  return meanRgba(PNG.sync.read(readFileSync(path)), sampleUVs);
}

function meanRgba(img: { width: number; height: number; data: Uint8Array }, sampleUVs?: ArrayLike<number>): [number, number, number] {
  let n = 0;
  const mean = [0, 0, 0];
  const add = (i: number) => {
    if (img.data[i + 3] <= 128) return;
    n++;
    // Averaged in linear light: the renderer divides each (linear) texel's brightness by this mean.
    for (let c = 0; c < 3; c++) mean[c] += srgbToLinear(img.data[i + c] / 255);
  };
  if (sampleUVs?.length) {
    const wrap = (t: number) => t - Math.floor(t);
    for (let k = 0; k + 1 < sampleUVs.length; k += 2) {
      const x = Math.min(img.width - 1, Math.floor(wrap(sampleUVs[k]) * img.width));
      const y = Math.min(img.height - 1, Math.floor((1 - wrap(sampleUVs[k + 1])) * img.height));
      add((y * img.width + x) * 4);
    }
  }
  if (!n) for (let i = 0; i < img.data.length; i += 4) add(i);
  return mean.map((v) => (n ? linearToSrgb(v / n) : 0.5)) as [number, number, number];
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Mean sRGB colour (0..1) of an image's non-black pixels (e.g. a skin texture without its empty UV space). */
export function meanColor(path: string, step = 7): [number, number, number] {
  const buf = readFileSync(path);
  const img = path.endsWith(".png") ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true });
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < img.width * img.height; i += step) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
    if (r + g + b < 60) continue;
    sum[0] += r; sum[1] += g; sum[2] += b;
    n++;
  }
  return sum.map((v) => Math.round((n ? v / n / 255 : 0.5) * 1000) / 1000) as [number, number, number];
}

/**
 * Recolours a PNG in place to an sRGB colour (0..1), keeping its light/dark
 * pattern: each pixel becomes `rgb * luminance / mean luminance` (alpha kept).
 */
export function tintPng(path: string, rgb: [number, number, number]): void {
  const img = PNG.sync.read(readFileSync(path));
  const lum = (i: number) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  let sum = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 128) (sum += lum(i)), n++;
  const mean = Math.max(1, n ? sum / n : 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const f = Math.min(2.5, lum(i) / mean);
    for (let c = 0; c < 3; c++) img.data[i + c] = Math.min(255, Math.round(rgb[c] * 255 * f));
  }
  writeFileSync(path, PNG.sync.write(img));
}

/**
 * Turns a hair-card texture into hair masses (in place): we draw hair as solid,
 * cohesive locks, never as single hairs. The alpha is blurred and re-thresholded,
 * so gaps between strands close up and lone strands that stick out of a lock
 * fade away, leaving soft, lock-shaped edges. Fine strand-to-strand contrast is
 * softened toward the local mean colour (broad streaks stay), and texels that
 * were gaps take the surrounding colour, a little darker (depth between strands).
 * `radius` is the blur radius as a fraction of the texture width.
 */
export function massHairPng(path: string, radius = 0.004): void {
  const img = PNG.sync.read(readFileSync(path));
  const { width: w, height: h } = img;
  const n = w * h;
  const r = Math.max(1, Math.round(w * radius));
  const alpha: Gray = { width: w, height: h, data: new Float32Array(n) };
  for (let i = 0; i < n; i++) alpha.data[i] = img.data[i * 4 + 3] / 255;
  const ab = blurGray(alpha, r).data;
  // Alpha-weighted (premultiplied) colour blur: the mean colour of the hair around each texel.
  const mean = [0, 1, 2].map((c) => {
    const g: Gray = { width: w, height: h, data: new Float32Array(n) };
    for (let i = 0; i < n; i++) g.data[i] = (img.data[i * 4 + c] / 255) * alpha.data[i];
    return blurGray(g, r).data;
  });
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    const a0 = alpha.data[i], m = ab[i];
    const a = smooth(0.3, 0.55, m);
    for (let c = 0; c < 3; c++) {
      const local = m > 1e-4 ? mean[c][i] / m : img.data[i * 4 + c] / 255;
      const own = img.data[i * 4 + c] / 255;
      // Strand detail at half contrast where there was hair, the darker local colour in the gaps.
      const solid = own + (local - own) * 0.5;
      const v = solid * a0 + local * 0.82 * (1 - a0);
      img.data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  writeFileSync(path, PNG.sync.write(img));
}
