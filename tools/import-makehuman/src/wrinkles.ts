import { type Gray, blankGray, blurGray } from "./image";

/** Face landmarks on the base mesh (meters, +Y up, +Z forward). */
export interface FaceLandmarks {
  /** Eye centres and half widths (from the eyelash helpers). */
  eyes: { c: number[]; w: number }[];
  /** Teeth box: x0, x1, y0, y1 (from the teeth helpers). */
  teeth: [number, number, number, number];
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth 1D value noise, 0..1. */
const noise = (x: number) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
};
/** A crease profile: 1 at the line, falling off to 0 within `width` (a narrow valley with soft shoulders). */
const crease = (d: number, width: number) => Math.exp(-((d / width) ** 2));

/**
 * Expression wrinkle depth maps in the body's UV layout, drawn per texel from the 3D point it maps
 * to (`pos`: x, y, z images, shifted by +10 so empty texels are < 5). Three groups, each lit by its
 * own face units at run time:
 *  - forehead: horizontal lines (brows raised),
 *  - frown: the vertical "11" between the brows and the line across the nose root (brows lowered, nose wrinkled),
 *  - smile: crow's feet at the outer eye corners and the nasolabial fold (smile, squint).
 * Values are crease depth 0..1.
 */
export function wrinkleMasks(pos: Gray[], lm: FaceLandmarks, size: number): { forehead: Gray; frown: Gray; smile: Gray } {
  const forehead = blankGray(size), frown = blankGray(size), smile = blankGray(size);
  const [eL, eR] = lm.eyes;
  const eyeY = (eL.c[1] + eR.c[1]) / 2, eyeZ = (eL.c[2] + eR.c[2]) / 2;
  const w = (eL.w + eR.w) / 2;
  const half = (Math.abs(eL.c[0]) + Math.abs(eR.c[0])) / 2; // eye centre to the midline
  const [tx0, tx1, ty0, ty1] = lm.teeth;
  const mouthHalf = Math.max(-tx0, tx1);
  const mouthY = ty0 + (ty1 - ty0) * 0.45;
  const noseY = ty1 + 0.012; // nose base above the upper teeth
  for (let i = 0; i < forehead.data.length; i++) {
    if (pos[0].data[i] < 5) continue;
    const x = pos[0].data[i] - 10, y = pos[1].data[i] - 10, z = pos[2].data[i] - 10;
    if (z < eyeZ - 0.06 || y < ty0 - 0.03 || y > eyeY + 0.09) continue;
    const ax = Math.abs(x), side = Math.sign(x) || 1;
    // Forehead: wavy horizontal lines, dipping toward the temples, broken into pieces.
    {
      const y0 = eyeY + 1.55 * w, y1 = eyeY + 3.7 * w;
      const region = smooth(y0 - 0.004, y0 + 0.006, y) * smooth(y1 + 0.004, y1 - 0.008, y) * smooth(half + 1.5 * w, half + 0.4 * w, ax) * smooth(eyeZ - 0.03, eyeZ - 0.01, z);
      if (region > 0) {
        const yy = y + 2.2 * x * x + 0.0012 * (noise(x * 35) - 0.5);
        const lambda = 0.0075;
        const phase = (yy - y0) / lambda;
        const k = Math.round(phase);
        const line = crease((phase - k) * lambda, 0.0016) * (0.55 + 0.45 * smooth(y1, y0 + 0.01, yy));
        const pieces = smooth(0.25, 0.55, noise(x * 55 + k * 17.3)) * (0.7 + 0.3 * noise(x * 120 + k * 3.1));
        forehead.data[i] = Math.max(forehead.data[i], region * line * pieces);
      }
    }
    // Frown: two vertical lines between the brows, slightly converging downward, and the nose-root line.
    {
      const yb = eyeY + 0.35 * w, yt = eyeY + 1.6 * w;
      const along = (y - yb) / (yt - yb);
      if (along > -0.3 && along < 1.3 && ax < half * 0.6) {
        const fade = smooth(-0.1, 0.25, along) * smooth(1.15, 0.7, along);
        const xl = 0.0042 + 0.0022 * along + 0.0006 * (noise(y * 300) - 0.5);
        const v = crease(ax - xl, 0.0015) * fade * 0.85;
        // Across the nose root, a little below the eyes' middle.
        const yr = eyeY - 0.15 * w;
        const root = crease(y - yr - 0.06 * ax, 0.001) * smooth(0.011, 0.005, ax) * 0.8;
        frown.data[i] = Math.max(frown.data[i], v, root);
      }
    }
    // Crow's feet: lines fanning out from each outer eye corner.
    for (const e of lm.eyes) {
      if (Math.sign(e.c[0]) !== side) continue;
      const cx = e.c[0] + side * e.w * 1.15, cy = e.c[1] - 0.1 * e.w;
      const dx = (x - cx) * side, dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (dx < -0.003 || r > 0.03) continue;
      const th = Math.atan2(dy, Math.max(1e-5, dx));
      if (Math.abs(th) > 1.0) continue;
      const step = 0.3; // radians between lines
      const kk = Math.round(th / step);
      const dth = (th - kk * step) * r; // arc distance to the nearest line
      const fan = crease(dth, 0.001 + 0.0005 * (r / 0.03));
      const v = fan * smooth(0.002, 0.007, r) * smooth(0.026, 0.012, r) * smooth(1.0, 0.6, Math.abs(th)) * (0.45 + 0.55 * noise(kk * 9.7 + 3)) * (0.75 + 0.25 * noise(r * 300 + kk));
      smile.data[i] = Math.max(smile.data[i], v);
    }
    // Nasolabial fold: from beside the nose wing to beyond the mouth corner, bowed outward.
    {
      const ax0 = 0.017, ay0 = noseY, bx = mouthHalf + 0.009, by = mouthY - 0.014;
      let best = Infinity, bs = 0;
      const curve = (s: number) => [ax0 + (bx - ax0) * s + 0.006 * Math.sin(Math.PI * s), ay0 + (by - ay0) * s];
      for (let k = 0; k < 20; k++) {
        // Distance to each segment of the curve (points alone would leave beads).
        const [px, py] = curve(k / 20), [qx, qy] = curve((k + 1) / 20);
        const ex = qx - px, ey = qy - py;
        const t = Math.min(1, Math.max(0, ((ax - px) * ex + (y - py) * ey) / (ex * ex + ey * ey)));
        const d = Math.hypot(ax - px - ex * t, y - py - ey * t);
        if (d < best) (best = d), (bs = (k + t) / 20);
      }
      if (best < 0.01 && z > eyeZ - 0.02) {
        const v = crease(best, 0.0026 + 0.0014 * bs) * smooth(0, 0.2, bs) * smooth(1, 0.75, bs) * 0.8;
        smile.data[i] = Math.max(smile.data[i], v);
      }
    }
  }
  return { forehead: blurGray(forehead, 1, 1), frown: blurGray(frown, 1, 1), smile: blurGray(smile, 1, 1) };
}
