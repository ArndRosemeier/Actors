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
