/**
 * TSL versions of the GLSL noise in ../racepatterns.ts (GLSL_NOISE): hashes,
 * value noise, fbm and Voronoi cells, as real shader functions (setLayout),
 * so a material that calls them many times stays small and compiles fast.
 */
import { Fn, Loop, dFdx, dFdy, dot, float, floor, fract, If, mix, normalize, sign, sqrt, abs, vec2, vec3, cross } from "./tsl";
import type { N } from "./types";

export const hash13 = Fn(([p_]: N[]) => {
  const p = fract(p_.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.zyx.add(31.32)));
  return fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: "h_hash13", type: "float", inputs: [{ name: "p", type: "vec3" }] });

export const hash33 = Fn(([p_]: N[]) => {
  const p = fract(p_.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p.addAssign(dot(p, p.yxz.add(33.33)));
  return fract(p.xxy.add(p.yxx).mul(p.zyx));
}).setLayout({ name: "h_hash33", type: "vec3", inputs: [{ name: "p", type: "vec3" }] });

export const hash12 = Fn(([p]: N[]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: "h_hash12", type: "float", inputs: [{ name: "p", type: "vec2" }] });

export const noise3 = Fn(([p]: N[]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2).add(3)).toVar();
  const a = hash13(i), b = hash13(i.add(vec3(1, 0, 0))), c = hash13(i.add(vec3(0, 1, 0))), d = hash13(i.add(vec3(1, 1, 0)));
  const e = hash13(i.add(vec3(0, 0, 1))), f1 = hash13(i.add(vec3(1, 0, 1))), g = hash13(i.add(vec3(0, 1, 1))), h = hash13(i.add(vec3(1, 1, 1)));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}).setLayout({ name: "h_noise3", type: "float", inputs: [{ name: "p", type: "vec3" }] });

export const noise2 = Fn(([p]: N[]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2).add(3)).toVar();
  return mix(mix(hash12(i), hash12(i.add(vec2(1, 0))), u.x), mix(hash12(i.add(vec2(0, 1))), hash12(i.add(vec2(1, 1))), u.x), u.y);
}).setLayout({ name: "h_noise2", type: "float", inputs: [{ name: "p", type: "vec2" }] });

export const fbm3 = Fn(([p_]: N[]) => {
  const p = vec3(p_).toVar();
  const s = float(0).toVar();
  const a = float(0.5).toVar();
  Loop(4, () => {
    s.addAssign(a.mul(noise3(p)));
    p.assign(p.mul(2.03).add(17.1));
    a.mulAssign(0.5);
  });
  return s;
}).setLayout({ name: "h_fbm3", type: "float", inputs: [{ name: "p", type: "vec3" }] });

/** Voronoi: x = F1 distance, y = F2 distance, z = cell id hash. */
export const voronoi3 = Fn(([p]: N[]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const d1 = float(8).toVar(), d2 = float(8).toVar(), id = float(0).toVar();
  Loop({ start: -1, end: 2, name: "z" }, { start: -1, end: 2, name: "y" }, { start: -1, end: 2, name: "x" }, ({ x, y, z }: { x: N; y: N; z: N }) => {
    const g = vec3(float(x), float(y), float(z)).toVar();
    const r = g.add(hash33(i.add(g))).sub(f).toVar();
    const d = dot(r, r).toVar();
    If(d.lessThan(d1), () => {
      d2.assign(d1);
      d1.assign(d);
      id.assign(hash13(i.add(g).add(7.7)));
    }).ElseIf(d.lessThan(d2), () => {
      d2.assign(d);
    });
  });
  return vec3(sqrt(d1), sqrt(d2), id);
}).setLayout({ name: "h_voronoi3", type: "vec3", inputs: [{ name: "p", type: "vec3" }] });

/** Normal from a height field (meters) by screen-space derivatives (view space in, view space out). */
export const bumpNormal = Fn(([surfPos, n, h, faceDir]: N[]) => {
  const sx = dFdx(surfPos).toVar(), sy = dFdy(surfPos).toVar();
  const r1 = cross(sy, n).toVar(), r2 = cross(n, sx).toVar();
  const det = dot(sx, r1).mul(faceDir).toVar();
  const grad = sign(det).mul(dFdx(h).mul(r1).add(dFdy(h).mul(r2)));
  return normalize(abs(det).mul(n).sub(grad));
});
