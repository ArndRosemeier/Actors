/**
 * The cow's extra meshes, generated like the horse's tack: horns (shown on
 * every cow; the `horns-none` and `horns-long` morphs shrink them into the poll
 * or sweep them out), and an alpine collar with its bell (optional, tag `bell`).
 * Horns are rigid on the head; the collar takes the skin weights of the neck
 * under it, and the bell hangs from the collar's lowest point.
 */
import { type Vec3, normalize } from "@actors/core";
import type { CowBody } from "./cow";
import { layer } from "./horse";
import { type Part, type Primitive, capsule, loft } from "./sdf";
import { type TackPiece, meshParts, nearestSkin } from "./tack";

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

interface Surface {
  positions: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
}

/** Horn radius along its length (t: 0 root .. 1 tip). */
const hornRadius = (t: number) => 0.03 * (1 - t) ** 0.9 + 0.005;

export async function cowParts(body: CowBody, surface: Surface, cell: number): Promise<TackPiece[]> {
  const { rig, cow } = body;
  const headBone = rig.index.get("head")!;
  const near = nearestSkin(surface);
  const part = (prim: Primitive, k = 0, carve = false): Part => ({ prim, k, carve });

  // --- Horns: tapered round cones along the horn lines; the last fifth is the dark tip ---
  const hornParts = (from: number, to: number): Part[] => {
    const out: Part[] = [];
    for (const line of cow.horns) {
      const lengths = line.slice(1).map((q, i) => len(sub(q, line[i])));
      const total = lengths.reduce((a, b) => a + b, 0);
      let run = 0;
      for (let i = 0; i + 1 < line.length; i++) {
        const t0 = run / total, t1 = (run + lengths[i]) / total;
        run += lengths[i];
        if (t1 <= from || t0 >= to) continue;
        const a0 = Math.max(t0, from), a1 = Math.min(t1, to);
        const pa = add(line[i], scale(sub(line[i + 1], line[i]), (a0 - t0) / (t1 - t0)));
        const pb = add(line[i], scale(sub(line[i + 1], line[i]), (a1 - t0) / (t1 - t0)));
        // The root sinks into the poll.
        const start = i === 0 && from === 0 ? add(pa, scale(normalize(sub(line[1], line[0])), -0.025)) : pa;
        out.push(part(capsule("horn", start, pb, hornRadius(a0), to >= 1 && a1 >= 1 ? 0.003 : hornRadius(a1)), 0.01));
      }
    }
    return out;
  };

  // --- Collar: a leather strap round the neck, in the plane through its top and bottom points ---
  const { top, bottom } = cow.collar;
  const d = sub(top, bottom);
  const plane = normalize(cross([1, 0, 0], d));
  const collarMask = (p: Vec3) => Math.abs(dot(sub(p, top), plane)) - 0.021;
  const collarLo: Vec3 = [-0.4, bottom[1] - 0.1, Math.min(top[2], bottom[2]) - 0.15], collarHi: Vec3 = [0.4, top[1] + 0.1, Math.max(top[2], bottom[2]) + 0.15];
  const collar: Part[] = [part(layer("collar", cow.skin, 0.008, 0.005, collarMask, collarLo, collarHi))];
  // Buckle loop under the throat that the bell hangs from.
  const neckBottom = (() => {
    // The lowest point of the collar on the midline: walk up from below until the skin.
    let y = bottom[1] - 0.2;
    const z = bottom[2];
    while (y < top[1] && cow.skin.every((p) => p.prim.distance([0, y, z]) > 0.0)) y += 0.002;
    return [0, y - 0.01, z] as Vec3;
  })();
  const loopTop = add(neckBottom, [0, -0.005, 0]);
  collar.push(part(capsule("loop", add(loopTop, [0, 0, -0.02]), add(loopTop, [0, -0.035, 0]), 0.008, 0.007, [1, 0, 0], [0.5, 1]), 0.006));
  collar.push(part(capsule("loop", add(loopTop, [0, 0, 0.02]), add(loopTop, [0, -0.035, 0]), 0.008, 0.007, [1, 0, 0], [0.5, 1]), 0.006));

  // --- Bell: a flattened, flaring alpine bell under the loop, open at the bottom ---
  const bellTop = add(loopTop, [0, -0.04, 0]);
  // A tall alpine bell: narrow shoulders, flaring to an oval mouth (about 18 cm tall, 14 cm across).
  const B = (dy: number, w: number, d: number, n: number) => ({ at: add(bellTop, [0, dy, 0]), w, up: d, down: d, n });
  const bellKeys = [B(0.0, 0.035, 0.026, 2.6), B(-0.02, 0.058, 0.04, 2.8), B(-0.09, 0.064, 0.044, 3), B(-0.16, 0.074, 0.05, 3.2), B(-0.18, 0.078, 0.053, 3.2)];
  // Path downwards; the sections' "up" points forward (+Z), so w is across the cow.
  const bell: Part[] = [
    part(loft("bell", bellKeys, [0, 0, 1])),
    // Hollow inside, open at the mouth.
    // The clapper's ball shows under the rim.
    part(capsule("clapper", add(bellTop, [0, -0.16, 0]), add(bellTop, [0, -0.192, 0]), 0.012, 0.016), 0.004),
    part(capsule("crown", add(bellTop, [-0.02, 0.0, 0]), add(bellTop, [0.02, 0.0, 0]), 0.009, 0.009), 0.008),
  ];

  const pieces: { name: string; parts: Part[]; cell: number; triangles: number; material: TackPiece["material"]; color: [number, number, number]; roughness: number; tags: string[]; rigid?: number | "loop"; optional: boolean }[] = [
    // Horn colours are linear: a waxy cream, dark slate tips.
    { name: "horns", parts: hornParts(0, 0.8), cell: cell * 0.5, triangles: 3000, material: "other", color: [0.62, 0.52, 0.36], roughness: 0.45, tags: ["horns"], rigid: headBone, optional: false },
    { name: "horn-tips", parts: hornParts(0.78, 1), cell: cell * 0.4, triangles: 1000, material: "other", color: [0.04, 0.035, 0.03], roughness: 0.4, tags: ["horns"], rigid: headBone, optional: false },
    { name: "collar", parts: collar, cell: cell * 0.6, triangles: 5000, material: "other", color: [0.08, 0.03, 0.015], roughness: 0.55, tags: ["bell", "leather"], optional: true },
    { name: "bell", parts: bell, cell: cell * 0.4, triangles: 5000, material: "other", color: [0.3, 0.19, 0.07], roughness: 0.45, tags: ["bell", "metal"], rigid: "loop", optional: true },
  ];
  const loopSkin = near(neckBottom);
  const out: TackPiece[] = [];
  for (const piece of pieces) {
    const t = Date.now();
    const mesh = await meshParts(piece.parts, piece.cell, piece.triangles);
    const n = mesh.positions.length / 3;
    const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const p: Vec3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
      if (typeof piece.rigid === "number") {
        joints.set([piece.rigid, 0, 0, 0], v * 4);
        weights.set([1, 0, 0, 0], v * 4);
      } else {
        const s = piece.rigid === "loop" ? loopSkin : near(p);
        joints.set(s.joints, v * 4);
        weights.set(s.weights, v * 4);
      }
    }
    console.log(`  ${piece.name}: ${n} vertices, ${mesh.indices.length / 3} triangles (${Date.now() - t} ms)`);
    out.push({ name: piece.name, positions: mesh.positions, indices: mesh.indices, uv: new Float32Array(n * 2), joints, weights, material: piece.material, color: piece.color, roughness: piece.roughness, tags: piece.tags, optional: piece.optional });
  }
  return out;
}
