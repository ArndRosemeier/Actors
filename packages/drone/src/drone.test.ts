import { describe, expect, it } from "vitest";
import { ARCHETYPES, type ArchetypeId, EFFECT_SLOTS, PALETTES, box, buildDrone, designDrone, generateDrone, lathe, roundedRect, superellipsoid, sweep } from "./index";
import type { Geom } from "./geom";

const ARCHS = Object.keys(ARCHETYPES) as ArchetypeId[];

/** Fraction of triangles whose winding agrees with their vertex normals. */
function agreement(g: Geom): number {
  let ok = 0;
  for (let k = 0; k < g.i.length; k += 3) {
    const [a, b, c] = [g.i[k], g.i[k + 1], g.i[k + 2]].map((v) => [g.p[3 * v], g.p[3 * v + 1], g.p[3 * v + 2]]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const n = [0, 1, 2].map((d) => g.n[3 * g.i[k] + d] + g.n[3 * g.i[k + 1] + d] + g.n[3 * g.i[k + 2] + d]);
    if (fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] >= 0) ok++;
  }
  return ok / (g.i.length / 3);
}

describe("drone primitives", () => {
  it("point normals outwards", () => {
    const shapes: Geom[] = [box(1, 0.5, 2, 0.1), superellipsoid(1, 0.5, 0.8, 0.5, 0.8), lathe(roundedRect(0.5, 0.6, -0.1, 0.1, 0.03), 24, true)];
    shapes.push(sweep([{ o: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], w: 0.3, up: 0.2, down: 0.1, n: 4 }, { o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], w: 0.1, up: 0.1, down: 0.1 }]));
    for (const g of shapes) {
      expect(agreement(g)).toBeGreaterThan(0.99);
      // Outward: normals point away from the centre on average.
      let out = 0;
      for (let k = 0; k < g.p.length; k += 3) out += g.p[k] * g.n[k] + g.p[k + 1] * g.n[k + 1] + g.p[k + 2] * g.n[k + 2];
      expect(out).toBeGreaterThan(0);
    }
  });
});

describe("drones", () => {
  it("are deterministic per seed", () => {
    const a = generateDrone({ seed: 77 }), b = generateDrone({ seed: 77 });
    expect(a.spec).toEqual(b.spec);
    expect(a.triangles).toBe(b.triangles);
    expect(a.meshes[0].positions).toEqual(b.meshes[0].positions);
    expect(generateDrone({ seed: 78 }).spec).not.toEqual(a.spec);
  });

  it("keep their shape when only the palette or weapons change", () => {
    const a = designDrone({ seed: 5, archetype: "worker" });
    const b = designDrone({ seed: 5, archetype: "worker", palette: "neon", armed: true });
    expect(b.hull).toEqual(a.hull);
    expect(b.propulsion).toEqual(a.propulsion);
    expect(b.palette.name).toBe(PALETTES.neon.name);
  });

  it("carry weapons only when armed", () => {
    for (const archetype of ARCHS) {
      for (let seed = 1; seed <= 5; seed++) {
        expect(designDrone({ seed, archetype }).weapons).toHaveLength(0);
        expect(designDrone({ seed, archetype, armed: true }).weapons.length).toBeGreaterThan(0);
      }
    }
  });

  it("build every role with valid meshes and looping clips", () => {
    for (const archetype of ARCHS) {
      for (const seed of [1, 2, 3]) {
        const m = generateDrone({ seed, archetype, armed: seed === 3 });
        expect(m.triangles).toBeGreaterThan(2000);
        for (const mesh of m.meshes) {
          expect(mesh.positions.every(Number.isFinite)).toBe(true);
          expect(mesh.indices.every((i) => i < mesh.positions.length / 3)).toBe(true);
          if (mesh.fade) expect(mesh.fade.length).toBe(mesh.positions.length / 3);
          if (EFFECT_SLOTS.includes(mesh.slot)) continue;
        }
        expect(new Set(m.nodes.map((n) => n.name)).size).toBe(m.nodes.length);
        expect(m.clips.map((c) => c.name)).toEqual(expect.arrayContaining(["hover", "cruise", "scan", "land"]));
        expect(m.clips.some((c) => c.name === "attack")).toBe(m.spec.weapons.length > 0);
        for (const c of m.clips) {
          for (const t of c.tracks) {
            const w = t.path === "quaternion" ? 4 : 3;
            const n = t.times.length;
            expect(t.values.length).toBe(n * w);
            for (let d = 0; d < w; d++) {
              const first = t.values[d], last = t.values[(n - 1) * w + d];
              // Loops: the last key matches the first (a quaternion may flip sign).
              if (t.path === "quaternion") expect(Math.abs(Math.abs(first) - Math.abs(last))).toBeLessThan(1e-4);
              else expect(Math.abs(first - last)).toBeLessThan(1e-4);
            }
          }
        }
        // Hovers above the ground and lands lower down.
        expect(m.bounds.min[1]).toBeGreaterThan(0);
        expect(m.landedHeight).toBeLessThan(m.hoverHeight);
        expect(m.landedHeight).toBeGreaterThan(0);
      }
    }
  });

  it("rebuilds an edited spec", () => {
    const spec = designDrone({ seed: 9, archetype: "scout" });
    spec.propulsion = { ...spec.propulsion, kind: "ducted", count: 6, layout: "radial" };
    spec.tools = [{ kind: "claws", mount: "belly", size: 1 }];
    const m = buildDrone(spec);
    expect(m.nodes.filter((n) => /^prop\d+$/.test(n.name))).toHaveLength(6);
    expect(m.nodes.some((n) => n.name.startsWith("claw_"))).toBe(true);
    expect(m.clips.some((c) => c.name === "work")).toBe(true);
  });
});
