/**
 * Chest emblems for hero costumes: plate shapes and symbols as 2D signed distance fields, and the
 * emblem texture painted from them. Renderer-free and deterministic; the Rust port
 * (actors-human `emblem.rs`) mirrors it. The plate geometry is cut from the body with the same
 * fields (see costume.ts), so the texture and the plate's edge always agree.
 *
 * Coordinates: the emblem's unit square, -1..1, x to the wearer's left (+X, the viewer's right
 * when facing the wearer), y up. Distances are negative inside.
 */

export type EmblemShape = "none" | "circle" | "shield" | "diamond" | "star" | "hexagon" | "badge" | "cutout";
export type EmblemSymbol = "none" | "star" | "bolt" | "atom" | "rocket" | "planet" | "comet" | "flame" | "eye" | "wings" | "crown";

export const EMBLEM_SHAPES: EmblemShape[] = ["none", "circle", "shield", "diamond", "star", "hexagon", "badge", "cutout"];
export const EMBLEM_SYMBOLS: EmblemSymbol[] = ["none", "star", "bolt", "atom", "rocket", "planet", "comet", "flame", "eye", "wings", "crown"];

type P = [number, number];
const length = (x: number, y: number) => Math.hypot(x, y);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Signed distance to a closed polygon (iq's sdPolygon). */
export function sdPolygon(x: number, y: number, v: P[]): number {
  let d = (x - v[0][0]) ** 2 + (y - v[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    const wx = x - v[i][0], wy = y - v[i][1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = y >= v[i][1], c2 = y < v[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

const circle = (x: number, y: number, cx: number, cy: number, r: number) => length(x - cx, y - cy) - r;
/** An ellipse ring (approximate distance), turned by `a`. */
function ellipse(x: number, y: number, rx: number, ry: number, a: number): number {
  const c = Math.cos(a), s = Math.sin(a);
  const u = x * c + y * s, v = -x * s + y * c;
  return (length(u / rx, v / ry) - 1) * Math.min(rx, ry);
}
const union = (...d: number[]) => Math.min(...d);
/** A teardrop from a round base (centre bx, by, radius r) to a point at (tx, ty). */
function teardrop(x: number, y: number, bx: number, by: number, r: number, tx: number, ty: number): number {
  const dx = tx - bx, dy = ty - by, l = Math.hypot(dx, dy);
  const u = ((x - bx) * dy - (y - by) * dx) / l, v = ((x - bx) * dx + (y - by) * dy) / l;
  // Two circles through the base's sides and the tip make the pointed upper half.
  const c = (l * l - r * r) / (2 * r), R = c + r;
  const lens = Math.max(length(u - c, v) - R, length(u + c, v) - R, -v);
  return Math.min(length(u, v) - r, lens);
}
const minus = (a: number, b: number) => Math.max(a, -b);

/** Points of a regular star (outer radius 1, inner `k`), first point up. */
function starPoints(n: number, k: number, r: number, cx = 0, cy = 0, turn = 0): P[] {
  const pts: P[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + turn + (i * Math.PI) / n;
    const rr = i % 2 ? r * k : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

const STAR = starPoints(5, 0.42, 0.98, 0, -0.04);
const HEX: P[] = Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3) * 0.98, Math.sin((i * Math.PI) / 3) * 0.98] as P);
const SHIELD: P[] = (() => {
  // A heater shield: flat top with rounded shoulders, straight sides, curving to a point.
  const pts: P[] = [[-0.86, 0.86], [0.86, 0.86], [0.9, 0.2]];
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    pts.push([0.9 * (1 - t) ** 1.25 * Math.cos(t * 0.6), 0.2 - 1.18 * Math.sin((t * Math.PI) / 2)]);
  }
  pts.push([0, -0.98]);
  for (let i = 11; i >= 1; i--) {
    const t = i / 12;
    pts.push([-0.9 * (1 - t) ** 1.25 * Math.cos(t * 0.6), 0.2 - 1.18 * Math.sin((t * Math.PI) / 2)]);
  }
  pts.push([-0.9, 0.2]);
  return pts;
})();
/** A police-style badge: a scalloped round plate. */
const BADGE: P[] = Array.from({ length: 96 }, (_, i) => {
  const a = (i / 96) * Math.PI * 2;
  const r = 0.9 + 0.08 * Math.cos(a * 8);
  return [Math.cos(a) * r, Math.sin(a) * r] as P;
});

const BOLT: P[] = [[0.18, 0.95], [-0.5, -0.05], [-0.06, -0.05], [-0.3, -0.95], [0.55, 0.18], [0.1, 0.18], [0.42, 0.95]];
const ROCKET_FINS: P[] = [[-0.22, -0.2], [-0.62, -0.7], [-0.58, -0.9], [-0.2, -0.62], [0.2, -0.62], [0.58, -0.9], [0.62, -0.7], [0.22, -0.2]];
const CROWN: P[] = [[-0.8, -0.55], [-0.85, 0.45], [-0.45, 0.0], [0, 0.7], [0.45, 0.0], [0.85, 0.45], [0.8, -0.55]];
const WING: P[] = [[0.08, 0.1], [0.95, 0.55], [0.85, 0.32], [0.98, 0.25], [0.78, 0.05], [0.9, -0.05], [0.62, -0.18], [0.7, -0.3], [0.08, -0.25]];
const WING_L: P[] = WING.map(([x, y]) => [-x, y] as P).reverse();

/** Plate outline: negative inside, in emblem units. "cutout" is the symbol's own outline. */
export function plateDistance(shape: EmblemShape, symbol: EmblemSymbol, x: number, y: number): number {
  switch (shape) {
    case "circle":
      return length(x, y) - 0.96;
    case "shield":
      return sdPolygon(x, y, SHIELD);
    case "diamond":
      return (Math.abs(x) * 0.78 + Math.abs(y) * 0.63 - 0.62) / Math.hypot(0.78, 0.63);
    case "star":
      return sdPolygon(x, y, STAR);
    case "hexagon":
      return sdPolygon(x, y, HEX);
    case "badge":
      return sdPolygon(x, y, BADGE);
    case "cutout":
      return symbol === "none" ? length(x, y) - 0.96 : symbolDistance(symbol, x / 0.95, y / 0.95).ink * 0.95;
    default:
      return 1;
  }
}

/** Where the symbol sits on each plate (centre y and scale; shields hold it high). */
export function symbolFrame(shape: EmblemShape): { cy: number; scale: number } {
  switch (shape) {
    case "shield":
      return { cy: 0.08, scale: 0.62 };
    case "star":
      return { cy: -0.04, scale: 0.4 };
    case "diamond":
      return { cy: 0, scale: 0.5 };
    case "cutout":
      return { cy: 0, scale: 0.95 };
    default:
      return { cy: 0, scale: 0.68 };
  }
}

/**
 * A symbol as two fields in its own unit square: `ink` (the symbol colour) and `cut` (details
 * drawn back in the plate colour on top of the ink: a rocket's porthole, an eye's iris ring).
 */
export function symbolDistance(symbol: EmblemSymbol, x: number, y: number): { ink: number; cut: number } {
  const none = 1;
  switch (symbol) {
    case "star":
      return { ink: sdPolygon(x, y, STAR), cut: none };
    case "bolt":
      return { ink: sdPolygon(x, y, BOLT), cut: none };
    case "atom": {
      const ring = (a: number) => Math.abs(ellipse(x, y, 0.95, 0.34, a)) - 0.075;
      return { ink: union(ring(0), ring(Math.PI / 3), ring((2 * Math.PI) / 3), circle(x, y, 0, 0, 0.2)), cut: none };
    }
    case "rocket": {
      // Body: the intersection of two circles makes the pointed nose; a flat tail.
      const body = Math.max(circle(x, y, -0.5, -0.2, 0.82), circle(x, y, 0.5, -0.2, 0.82), -(y + 0.62));
      const fins = sdPolygon(x, y, ROCKET_FINS);
      const flame = sdPolygon(x, y, [[-0.12, -0.66], [0.12, -0.66], [0, -0.98]]);
      return { ink: union(body, fins, flame), cut: Math.abs(circle(x, y, 0, 0.12, 0.13)) - 0.045 };
    }
    case "planet": {
      const ball = circle(x, y, 0, 0, 0.5);
      const ring = Math.abs(ellipse(x, y, 0.98, 0.26, 0.32)) - 0.07;
      // The ring passes behind the planet at the top and in front of it at the bottom.
      const behind = ring < 0 && ball < 0.06 && y + x * 0.33 > 0;
      return { ink: behind ? Math.max(ball, -(Math.abs(ring) - 0.0)) : union(ball, ring), cut: behind ? none : Math.max(-ring - 0.12, Math.abs(ring + 0.035) - 0.02, ball) };
    }
    case "comet": {
      const head = circle(x, y, 0.42, 0.42, 0.34);
      const tail = (o: number, w: number) => {
        // A tapered streak from the head down to the lower left.
        const dx = -0.7, dy = -0.7, l = Math.hypot(dx, dy);
        const ux = dx / l, uy = dy / l;
        const px = x - 0.42 - o * uy, py = y - 0.42 + o * ux;
        const t = clamp((px * ux + py * uy) / 1.35, 0, 1);
        const qx = px - ux * t * 1.35, qy = py - uy * t * 1.35;
        return length(qx, qy) - w * (1 - t) ** 1.4;
      };
      return { ink: union(head, tail(0, 0.26), tail(0.24, 0.12), tail(-0.24, 0.12)), cut: none };
    }
    case "flame": {
      const main = teardrop(x, y, 0, -0.42, 0.5, 0.06, 0.98);
      const left = teardrop(x, y, -0.3, -0.4, 0.3, -0.68, 0.42);
      const right = teardrop(x, y, 0.3, -0.45, 0.28, 0.66, 0.3);
      return { ink: union(main, left, right), cut: teardrop(x, y, 0, -0.52, 0.24, 0.02, 0.2) };
    }
    case "eye": {
      const almond = Math.max(circle(x, y, 0, -0.62, 0.98), circle(x, y, 0, 0.62, 0.98));
      return { ink: almond, cut: minus(circle(x, y, 0, 0, 0.36), circle(x, y, 0, 0, 0.16)) };
    }
    case "wings":
      return { ink: union(sdPolygon(x, y, WING), sdPolygon(x, y, WING_L), circle(x, y, 0, -0.05, 0.2)), cut: none };
    case "crown":
      return { ink: union(sdPolygon(x, y, CROWN), circle(x, y, 0, 0.78, 0.1), circle(x, y, -0.86, 0.55, 0.09), circle(x, y, 0.86, 0.55, 0.09)), cut: Math.min(circle(x, y, 0, -0.28, 0.1), circle(x, y, -0.45, -0.3, 0.07), circle(x, y, 0.45, -0.3, 0.07)) };
    default:
      return { ink: none, cut: none };
  }
}

export interface EmblemPaint {
  shape: EmblemShape;
  symbol: EmblemSymbol;
  /** sRGB 0..1 */
  plate: [number, number, number];
  ink: [number, number, number];
}

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The emblem texture: `size`² RGBA (sRGB bytes, row 0 at the top, so v = 1 - row / size is up).
 * The plate colour with a soft enamel sheen, the symbol embossed on it (a dark edge below, a light
 * one above) and its details cut back in the plate colour. Outside the plate is plate colour too
 * (the geometry ends at the plate's edge).
 */
export function emblemTexture(e: EmblemPaint, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const frame = symbolFrame(e.shape);
  const px = 2 / size;
  for (let row = 0; row < size; row++) {
    const y = 1 - ((row + 0.5) / size) * 2;
    for (let col = 0; col < size; col++) {
      const x = ((col + 0.5) / size) * 2 - 1;
      const sx = x / frame.scale, sy = (y - frame.cy) / frame.scale;
      const s = e.symbol === "none" || e.shape === "none" ? { ink: 1, cut: 1 } : symbolDistance(e.symbol, sx, sy);
      const ink = e.shape === "cutout" ? 1 : 1 - smooth(-px, px, s.ink * frame.scale);
      const cut = 1 - smooth(-px, px, s.cut * frame.scale);
      // Emboss: the field a little below/above the symbol's edge.
      const below = e.symbol === "none" ? 1 : symbolDistance(e.symbol, sx + 0.035, sy + 0.05).ink;
      const shadow = e.shape === "cutout" ? 0 : (1 - smooth(0, 0.08, below * frame.scale)) * (1 - ink) * 0.35;
      const rim = e.symbol === "none" ? 0 : smooth(-0.035, 0, s.ink * frame.scale) * ink;
      const sheen = 1.06 - 0.12 * smooth(0, 1.4, length(x + 0.35, y - 0.4));
      const o = (row * size + col) * 4;
      for (let k = 0; k < 3; k++) {
        const base = e.shape === "cutout" ? e.ink[k] : e.plate[k];
        let c = base * (1 - ink) + e.ink[k] * ink;
        c = c * (1 - cut) + e.plate[k] * cut;
        c *= (1 - shadow) * sheen * (1 - 0.12 * rim * (y < frame.cy ? 1 : -0.6));
        out[o + k] = Math.round(clamp(c, 0, 1) * 255);
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
