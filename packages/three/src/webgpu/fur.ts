/**
 * Fur for animal packs on three's WebGPURenderer (WebGPU and its WebGL 2
 * fallback): the node-material twin of ../fur.ts, with the same coat
 * colours and markings for every animal (dogs, squirrels, cats, deer,
 * horses, cows, chickens), the same shells and the same uniforms (`createFurUniforms`,
 * `setFurCoat`).
 *
 * As with the other node kinds, every fur body shares one node graph and
 * every shell stack another: each material's own coat is an input read at
 * each draw (`feed`), so a herd of horses in different coats is two shaders.
 */
import * as THREE from "three";
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { Fn, If, Loop, abs, attribute, clamp, cos, dot, float, floor, fract, fwidth, length, max, min, mix, mod, normalLocal, normalize, positionLocal, pow, select, sin, smoothstep, sqrt, step, vec2, vec3, vec4 } from "./tsl";
import type { ActorMaterialKit, ThreeActor } from "../index";
import { addFurShellsWith, type FurShells, type FurUniforms } from "../fur";
import { feed, input, nodeMaterials, once } from "./materials";
import { skinnedFlow, useNodeDqs } from "./dqs";
import type { N } from "./types";

/** A pack attribute, or zeros where the pack has none (not every animal has every coat channel). */
const coat = (name: string, type = "vec4") =>
  Fn((_: unknown, builder: N) => (builder.hasGeometryAttribute(name) ? attribute(name, type) : type === "vec4" ? vec4(0, 0, 0, 0) : vec3(0, 0, 0)))();

/** The coat uniforms of the drawn material (see `furInputs`). */
interface Coat {
  base: N; second: N; tan: N; white: N; leather: N;
  A: N; B: N; C: N; D: N; E: N; F: N; G: N; H: N; I: N; J: N; K: N; L: N; M: N; Nn: N; comb: N; shank: N; nose: N; fur: N; grain: N;
}

const coatInputs = once((): Coat => ({
  base: input("fur.base", new THREE.Color()),
  second: input("fur.second", new THREE.Color()),
  tan: input("fur.tan", new THREE.Color()),
  white: input("fur.white", new THREE.Color()),
  leather: input("fur.leather", new THREE.Color()),
  A: input("fur.A", new THREE.Vector4()), B: input("fur.B", new THREE.Vector4()), C: input("fur.C", new THREE.Vector4()),
  D: input("fur.D", new THREE.Vector4()), E: input("fur.E", new THREE.Vector4()), F: input("fur.F", new THREE.Vector4()),
  G: input("fur.G", new THREE.Vector4()), H: input("fur.H", new THREE.Vector4()), I: input("fur.I", new THREE.Vector4()),
  J: input("fur.J", new THREE.Vector4()), K: input("fur.K", new THREE.Vector4()),
  L: input("fur.L", new THREE.Vector4()), M: input("fur.M", new THREE.Vector4()), Nn: input("fur.N", new THREE.Vector4()),
  comb: input("fur.comb", new THREE.Color()), shank: input("fur.shank", new THREE.Color()),
  nose: input("fur.nose", new THREE.Vector4()),
  fur: input("fur.fur", new THREE.Vector4()),
  grain: input("fur.grain", 1),
}));

/** Feeds a fur material the coat it draws (the uniforms of ../fur.ts, read at each draw). */
function furInputs<T extends THREE.Material>(mat: T, u: FurUniforms): T {
  return feed(mat, {
    "fur.base": () => u.uBase.value, "fur.second": () => u.uSecond.value, "fur.tan": () => u.uTan.value, "fur.white": () => u.uWhite.value,
    "fur.leather": () => u.uLeather.value,
    "fur.A": () => u.uMarkA.value, "fur.B": () => u.uMarkB.value, "fur.C": () => u.uMarkC.value, "fur.D": () => u.uMarkD.value,
    "fur.E": () => u.uMarkE.value, "fur.F": () => u.uMarkF.value, "fur.G": () => u.uMarkG.value, "fur.H": () => u.uMarkH.value,
    "fur.I": () => u.uMarkI.value, "fur.J": () => u.uMarkJ.value, "fur.K": () => u.uMarkK.value,
    "fur.L": () => u.uMarkL.value, "fur.M": () => u.uMarkM.value, "fur.N": () => u.uMarkN.value, "fur.comb": () => u.uComb.value, "fur.shank": () => u.uShank.value, "fur.nose": () => u.uNose.value, "fur.fur": () => u.uFur.value, "fur.grain": () => u.uGrain.value,
  });
}

// ---- noise (the GLSL's furHash, furNoise, furFbm, furSpots)

const furHash = Fn(([p_]: N[]) => {
  const p = fract(p_.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p.addAssign(dot(p, p.yxz.add(33.33)));
  return fract(p.xxy.add(p.yxx).mul(p.zyx));
}).setLayout({ name: "fur_hash", type: "vec3", inputs: [{ name: "p", type: "vec3" }] });

const furNoise = Fn(([p]: N[]) => {
  const i = floor(p).toVar();
  const f0 = fract(p);
  const f = f0.mul(f0).mul(f0.mul(-2).add(3)).toVar();
  const h = (x: number, y: number, z: number) => furHash(i.add(vec3(x, y, z))).x;
  return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y), mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y), f.z);
}).setLayout({ name: "fur_noise", type: "float", inputs: [{ name: "p", type: "vec3" }] });

const furFbm = Fn(([p]: N[]) => furNoise(p).mul(0.6).add(furNoise(p.mul(2.1).add(7)).mul(0.3)).add(furNoise(p.mul(4.3).add(13)).mul(0.1))).setLayout({
  name: "fur_fbm",
  type: "float",
  inputs: [{ name: "p", type: "vec3" }],
});

/** Locks of hair: noise stretched along the fur's direction (about 4 mm across, 3 cm along). */
const furStreak = Fn(([p, flow]: N[]) => {
  const f = normalize(flow.add(1e-5));
  const q = p.sub(f.mul(dot(p, f)).mul(0.86)).toVar();
  return furNoise(q.mul(230)).mul(0.6).add(furNoise(q.mul(520).add(3)).mul(0.4));
}).setLayout({ name: "fur_streak", type: "float", inputs: [{ name: "p", type: "vec3" }, { name: "flow", type: "vec3" }] });

/** Round spots: distance to the nearest random point in a jittered grid. */
const furSpots = Fn(([p]: N[]) => {
  const c = floor(p).toVar();
  const best = float(1).toVar();
  Loop({ start: -1, end: 2, name: "z" }, { start: -1, end: 2, name: "y" }, { start: -1, end: 2, name: "x" }, ({ x, y, z }: { x: N; y: N; z: N }) => {
    const cell = c.add(vec3(float(x), float(y), float(z))).toVar();
    const r = furHash(cell).toVar();
    const radius = r.z.mul(0.2).add(0.22);
    best.assign(min(best, length(p.sub(cell).sub(0.15).sub(r.mul(0.7))).div(radius)));
  });
  return float(1).sub(smoothstep(0.85, 1, best));
}).setLayout({ name: "fur_spots", type: "float", inputs: [{ name: "p", type: "vec3" }] });

/** Deer spots in rows (q: along the spine, down from it, in spot spacings). */
const deerSpots = Fn(([q]: N[]) => {
  const c = floor(q).toVar();
  const best = float(9).toVar();
  Loop({ start: -1, end: 2, name: "y" }, { start: -1, end: 2, name: "x" }, ({ x, y }: { x: N; y: N }) => {
    const cell = c.add(vec2(float(x), float(y))).toVar();
    const r = furHash(vec3(cell, 17)).toVar();
    const ctr = cell.add(vec2(r.x.mul(0.6).add(0.2).add(mod(cell.y, 2).mul(0.5)), r.y.mul(0.5).add(0.25)));
    const radius = r.z.mul(r.z).mul(0.2).add(0.12);
    const d = length(q.sub(ctr).mul(vec2(0.68, 1))).div(radius).add(furNoise(vec3(q.mul(7), r.x.mul(9))).sub(0.5).mul(0.45));
    // (Some cells have no spot.)
    best.assign(min(best, mix(d, float(9), step(r.z, 0.1))));
  });
  return float(1).sub(smoothstep(0.55, 1.1, best));
}).setLayout({ name: "fur_deerSpots", type: "float", inputs: [{ name: "q", type: "vec2" }] });

/** Blend that looks linear to the eye (the coat is mixed in linear colour). */
const mixP = Fn(([a, b, t]: N[]) => {
  const m = mix(sqrt(max(a, 0)), sqrt(max(b, 0)), clamp(t, 0, 1));
  return m.mul(m);
}).setLayout({ name: "fur_mixP", type: "vec3", inputs: [{ name: "a", type: "vec3" }, { name: "b", type: "vec3" }, { name: "t", type: "float" }] });

/** Dark band of a stripe pattern: s in stripe periods, dark around whole numbers. */
const furStripe = (s: N, width: number) => {
  const d = abs(fract(s.add(0.5)).sub(0.5));
  const aa = max(fwidth(s), 0.04);
  return smoothstep(aa.add(width), float(width).sub(aa), d);
};

/** The pack's coat channels (as the GLSL's varyings). */
interface Ch { A: N; B: N; C: N; D: N; E: N; F: N; pos: N; flow: N }
const channels = (): Ch => ({ A: coat("coatA"), B: coat("coatB"), C: coat("coatC"), D: coat("coatD"), E: coat("coatE"), F: coat("coatF"), pos: coat("coatPos", "vec3"), flow: coat("furFlow", "vec3") });

/** Bare nose pad (packs with nose coordinates, when the coat sets a nose colour). */
const nosePad = (k: Coat, v: Ch) => {
  const q = v.F.xy.sub(vec2(0, 0.0008));
  const ell = length(q.div(vec2(0.0105, 0.0085)));
  return float(1).sub(smoothstep(0.85, 1, ell)).mul(smoothstep(-0.011, -0.006, v.F.z)).mul(step(0.5, k.nose.w));
};

/** Deer markings over the coat colour (all amounts 0 for other animals). */
function deerCoat(col: N, n: N, k: Coat, v: Ch): N {
  const along = v.F.y, fromSpine = v.F.z, spotty = v.F.w;
  const neckTone = max(v.A.y, smoothstep(0.42, 0.2, along).mul(float(1).sub(v.D.y)));
  col = mixP(col, k.tan, neckTone.mul(k.G.y).mul(float(1).sub(v.E.x)));
  const stripe = smoothstep(0.014, 0.006, fromSpine.add(n.mul(0.006))).mul(smoothstep(0.3, 0.38, along)).mul(float(1).sub(v.A.y));
  col = mix(col, mix(col, k.second, 0.85), stripe.mul(k.F.z));
  const spacing = max(k.F.y, 0.3).mul(0.034);
  const lower = smoothstep(0.27, 0.15, fromSpine);
  const sp = deerSpots(vec2(along, fromSpine.sub(0.012)).div(spacing).add(n.mul(0.35))).mul(smoothstep(0.008, 0.02, fromSpine)).mul(spotty).mul(mix(0.45, 1, lower));
  const line = smoothstep(1, 0, abs(fromSpine.sub(0.255)).div(0.011).add(furNoise(v.pos.mul(45)).mul(1.4)).sub(0.4)).mul(spotty).mul(smoothstep(0.5, 0.58, along)).mul(smoothstep(0.95, 0.85, along));
  col = mixP(col, k.white, clamp(max(sp, line.mul(0.5)), 0, 1).mul(k.F.x).mul(0.85));
  col = mixP(col, k.white, smoothstep(0.2, 0.7, v.B.z).mul(k.G.z));
  const innerEar = mixP(k.second, k.white, smoothstep(0.35, 0.8, furStreak(v.pos.mul(1.6).add(1.7), v.flow)).mul(0.22).add(0.24));
  col = mixP(col, innerEar, smoothstep(0.15, 0.6, v.E.y.add(n.mul(0.2))).mul(k.G.w));
  col = mixP(col, k.white, smoothstep(0.2, 0.6, v.E.z).mul(k.C.w));
  col = mix(col, k.white, smoothstep(0.3, 0.6, v.F.x.add(n.mul(0.2))).mul(k.F.w));
  col = mix(col, k.second.mul(0.6), clamp(smoothstep(0.25, 0.6, v.D.w.add(n.mul(0.2))).add(smoothstep(0.3, 0.6, v.E.w)), 0, 1).mul(k.G.x));
  return col;
}

/** Horse colours: mane and tail in their own colour, black points on the lower legs, dapples. */
function horseCoat(col: N, n: N, k: Coat, v: Ch): N {
  const hair = smoothstep(0.3, 0.7, v.E.z);
  const dp = furSpots(v.pos.div(0.08).add(n.mul(0.7))).mul(float(1).sub(v.A.y.mul(0.7))).mul(smoothstep(0.7, 0.95, v.A.x)).mul(float(1).sub(hair));
  col = mixP(col, k.white, dp.mul(k.I.z).mul(0.8));
  col = mix(col, k.second, smoothstep(0.97, 0.78, v.A.x.add(n.mul(0.12))).mul(k.I.y));
  const mane = k.tan.mul(furStreak(v.pos.mul(0.6).add(2.1), v.flow).mul(0.5).add(0.75));
  return mix(col, mane, hair.mul(k.I.x));
}

/** Cow colours: a darker head, white patches (piebald), pink udder skin (all 0 for other animals). */
function cowCoat(col: N, n: N, k: Coat, v: Ch): N {
  col = mix(col, k.second, smoothstep(0.3, 0.8, v.A.y.add(n.mul(0.2))).mul(float(1).sub(smoothstep(0.2, 0.6, v.E.x))).mul(k.J.w).mul(0.75));
  const q = v.pos.div(max(k.J.y, 0.3).mul(0.32));
  const f = furFbm(q.add(vec3(3.7, 1.3, 8.1))).add(furNoise(q.mul(4.3).add(2.1)).sub(0.5).mul(0.18)).toVar();
  const th = float(0.75).sub(k.J.x.mul(0.5));
  const e = max(fwidth(f), 0.006);
  col = mix(col, k.white, smoothstep(th.sub(e), th.add(e), f).mul(step(0.001, k.J.x)));
  col = mix(col, k.white.mul(vec3(1, 0.74, 0.68)), smoothstep(0.3, 0.7, v.E.w).mul(k.J.z));
  const ear = mixP(vec3(0.5, 0.2, 0.13), k.white, smoothstep(0.4, 0.8, furStreak(v.pos.mul(1.4).add(0.9), v.flow)).mul(0.35).add(0.15));
  return mixP(col, ear, smoothstep(0.15, 0.6, v.E.y.add(n.mul(0.2))).mul(k.K.x));
}

/** Mackerel tabby (coatF on cat packs holds the stripe coordinates). */
function furTabby(p: N, v: Ch): N {
  const legW = v.F.w, headW = v.A.y, tailT = v.A.w;
  const tailW = smoothstep(0, 0.06, tailT);
  const trunkW = max(0, float(1).sub(legW).sub(headW).sub(tailW));
  const warp = furFbm(p.mul(30)).sub(0.5).mul(1.4).toVar();
  const broken = smoothstep(0.3, 0.55, furFbm(p.mul(48).add(11)));
  let t = trunkW.mul(furStripe(v.F.x.add(warp), 0.25)).mul(mix(0.45, 1, broken));
  t = t.add(legW.mul(furStripe(v.F.y.add(warp.mul(0.4)), 0.15)).mul(0.75));
  t = t.add(headW.mul(furStripe(v.F.z.add(warp.mul(0.25)), 0.16)));
  t = t.add(tailW.mul(furStripe(tailT.mul(8).add(warp.mul(0.3)), 0.2)));
  t = t.mul(v.E.z).mul(float(1).sub(smoothstep(0.45, 0.95, v.D.y).mul(0.8)));
  t = max(t, smoothstep(0.93, 0.995, v.D.x.add(warp.mul(0.05))).mul(trunkW.add(tailW)));
  return clamp(t, 0, 1);
}

/** Chicken feathers: the feather on top at this point (along 0..1, across 0..1, random, covered); see ../fur.ts chickFeather. */
const chickFeather = Fn(([q, f]: N[]) => {
  const c = floor(q).toVar();
  const bestKey = float(1e9).toVar();
  const res = vec4(1, 1, 0.5, 0).toVar();
  Loop({ start: -1, end: 2, name: "z" }, { start: -1, end: 2, name: "y" }, { start: -1, end: 2, name: "x" }, ({ x, y, z }: { x: N; y: N; z: N }) => {
    const cell = c.add(vec3(float(x), float(y), float(z))).toVar();
    const r = furHash(cell.add(3.1)).toVar();
    const root = cell.add(0.15).add(r.mul(0.7)).toVar();
    const d = q.sub(root).toVar();
    const a = dot(d, f).toVar();
    const b = length(d.sub(f.mul(a))).toVar();
    const m = a.div(1.8).mul(2).sub(1).toVar();
    const hw = sqrt(max(0, float(1).sub(m.mul(m)))).mul(0.85).mul(m.mul(0.25).add(0.75)).toVar();
    const key = dot(root, f).toVar();
    If(a.greaterThan(0).and(a.lessThan(1.8)).and(b.lessThan(hw)).and(key.lessThan(bestKey)), () => {
      bestKey.assign(key);
      res.assign(vec4(a.div(1.8), b.div(max(hw, 1e-3)), r.z, 1));
    });
  });
  return res;
}).setLayout({ name: "fur_chickFeather", type: "vec4", inputs: [{ name: "q", type: "vec3" }, { name: "f", type: "vec3" }] });

/** Chicken plumage over the coat colour (the GLSL's chickenCoat; only drawn on packs with feathers). */
function chickenCoat(col: N, n: N, k: Coat, v: Ch): N {
  const hackle = v.F.x, fluffW = v.F.z;
  const tailW = smoothstep(0.2, 0.6, v.E.z);
  col = mix(col, k.tan, smoothstep(0.15, 0.6, hackle.add(n.mul(0.2))));
  col = mix(col, k.second, tailW.mul(k.M.z));
  col = mixP(col, k.white, smoothstep(0.2, 0.7, fluffW.add(n.mul(0.3))).mul(k.Nn.x)).toVar();
  const size = max(k.L.y, 0.3).mul(0.011).mul(max(v.F.w, 0.2));
  const q = v.pos.div(size).toVar();
  const fe = chickFeather(q, normalize(v.flow.add(1e-5))).toVar();
  const t = fe.x, e = fe.y;
  let feather: N = col.mul(fe.z.mul(0.24).add(0.88)).mul(mix(0.78, 1.05, smoothstep(0, 0.55, t))).toVar();
  feather = mixP(feather, mix(feather, k.white, 0.6), k.L.z.mul(float(1).sub(smoothstep(0.05, 0.16, e))).mul(smoothstep(0.12, 0.5, t)));
  feather = mix(feather, k.second, k.M.y.mul(hackle).mul(float(1).sub(smoothstep(0.3, 0.55, e))).mul(smoothstep(0.05, 0.3, t)));
  feather = mix(feather, k.second, k.L.w.mul(smoothstep(0.66, 0.84, max(e, smoothstep(0.8, 0.98, t)))));
  feather = mix(feather, k.second, k.M.x.mul(furStripe(t.mul(3.2).add(0.2), 0.2)).mul(0.92));
  feather = mix(feather, k.white, k.M.w.mul(step(0.45, fe.z)).mul(smoothstep(0.8, 0.92, t)).mul(float(1).sub(smoothstep(0.6, 0.85, e))));
  feather = mix(feather, k.white, k.Nn.y.mul(tailW).mul(smoothstep(0.78, 1, v.A.w.add(fe.z.mul(0.2)))));
  feather = mix(feather.mul(0.74), feather, fe.w);
  const avg = mix(mix(col, k.second, k.L.w.mul(0.3).add(k.M.x.mul(0.4)).add(k.M.y.mul(0.25).mul(hackle))), k.white, k.M.w.mul(0.1)).mul(0.95);
  return mix(feather, avg, smoothstep(0.35, 1, length(fwidth(q))));
}

/** Coat colour from the region data and the markings (the GLSL's furCoat). */
function furCoat(k: Coat, v: Ch): N {
  const legT = v.A.x, headW = v.A.y, muzzleT = v.A.z, tailT = v.A.w;
  const ear = v.B.x, brow = v.B.z, bib = v.B.w;
  const back = v.D.x, mask = v.D.z, blaze = v.D.w;
  const under = v.D.y.mul(float(1).sub(v.E.z.mul(step(0.01, k.E.z)))).toVar();
  const p = v.pos.div(k.grain).toVar();
  const n = furFbm(p.mul(22)).sub(0.5).toVar();
  let col: N = vec3(k.base).toVar();
  col = mix(col, mix(col, k.white, 0.5), smoothstep(0.2, 0.8, under).mul(k.C.z));
  col = col.mul(float(1).sub(k.C.z.mul(0.25).mul(smoothstep(0.6, 1, back))));
  const sw = mix(0.08, 0.3, k.D.y);
  col = mix(col, k.second, smoothstep(float(0.5).sub(sw), sw.add(0.5), back.mul(k.A.x.mul(0.75).add(0.35)).add(n.mul(0.35))).mul(step(0.01, k.A.x)).mul(float(1).sub(headW)));
  col = mix(col, k.second, smoothstep(0.35, 0.6, mask.add(n.mul(0.25))).mul(k.A.y));
  col = mix(col, k.second, smoothstep(0.3, 0.6, ear).mul(max(k.A.y, k.A.x.mul(0.85))));
  const pts = max(max(brow.mul(1.6), mask.mul(0.9).mul(float(1).sub(smoothstep(0.2, 0.6, v.D.w.mul(3))))), max(float(1).sub(legT).mul(1.1), bib.mul(0.55)));
  col = mix(col, k.tan, smoothstep(0.45, 0.6, pts.add(n.mul(0.15))).mul(k.A.z));
  {
    const where = float(1).sub(v.D.y).mul(v.D.x.mul(0.7).add(0.3)).mul(float(1).sub(v.E.x)).mul(float(1).sub(float(1).sub(v.A.x).mul(0.6)));
    col = mix(col, k.second.mul(0.75), smoothstep(0.42, 0.72, furStreak(p.add(0.37), v.flow)).mul(where).mul(k.D.y).mul(0.6));
  }
  col = mix(col, k.white, smoothstep(0.3, 0.7, v.E.x.add(n.mul(0.25))).mul(k.D.x));
  col = mix(col, k.tan, smoothstep(1, 0.7, legT.add(n.mul(0.15))).mul(k.D.z));
  col = deerCoat(col, n, k, v);
  col = horseCoat(col, n, k, v);
  col = cowCoat(col, n, k, v);
  {
    // Feathers only on chicken packs (the feather search is not free).
    const c = vec3(col).toVar();
    If(k.L.x.greaterThan(0.5), () => {
      c.assign(chickenCoat(c, n, k, v));
    });
    col = c;
  }
  {
    // Cats: tortoiseshell patches, tabby stripes, light inner ears (all 0 elsewhere).
    const cat = step(1e-4, k.H.x.add(k.H.y).add(k.H.z));
    const tortie = smoothstep(0.6, 0.68, furFbm(p.mul(7).add(5.3)).add(n.mul(0.15)).add(v.D.x.mul(0.06))).mul(k.H.y).mul(float(1).sub(headW.mul(0.5))).mul(float(1).sub(v.D.y)).mul(cat);
    col = mix(col, k.tan, tortie);
    col = mix(col, mix(k.second, k.tan.mul(0.45), tortie), furTabby(p, v).mul(k.H.x).mul(cat));
    col = mix(col, k.white, smoothstep(0.2, 0.6, v.E.y).mul(k.H.z).mul(cat));
  }
  const spot = furSpots(p.div(max(k.C.y, 0.2).mul(0.034))).mul(k.C.x).mul(float(1).sub(v.C.x));
  col = mix(col, k.second, spot);
  let white = smoothstep(0.5, 0.65, under.add(n.mul(0.25))).mul(k.A.w);
  white = max(white, smoothstep(0.35, 0.6, bib.add(n.mul(0.2))).mul(k.B.x));
  white = max(white, float(1).sub(smoothstep(k.B.y.mul(0.92).sub(0.1), k.B.y.mul(0.92), legT.add(n.mul(0.1)))).mul(step(0.01, k.B.y)));
  white = max(white, smoothstep(0.25, 0.5, blaze.mul(1.4).mul(k.B.z).add(muzzleT.mul(k.B.z).mul(0.6).mul(step(0.5, k.B.z))).add(n.mul(0.1))).mul(step(0.01, k.B.z)));
  white = max(white, smoothstep(float(1).sub(k.B.w.mul(0.3)), float(1).sub(k.B.w.mul(0.24)), tailT).mul(step(0.01, k.B.w)));
  white = max(white, smoothstep(float(1).sub(k.I.w), float(1.06).sub(k.I.w), v.D.w.add(n.mul(0.08))).mul(step(0.01, k.I.w)).mul(step(0.002, v.D.w)).mul(float(1).sub(smoothstep(0.3, 0.6, v.E.z))));
  col = mix(col, k.white, white);
  {
    const fleck = furStreak(p.mul(0.9).add(2.3), v.flow).toVar();
    const where = float(1).sub(under).mul(float(1).sub(v.E.y)).mul(float(1).sub(v.C.x));
    col = mix(col, mix(k.white, k.base, 0.25), smoothstep(0.5, 0.68, fleck).mul(where).mul(k.E.y).mul(0.75));
    col = mix(col, k.second, smoothstep(0.4, 0.26, fleck).mul(where).mul(k.E.y).mul(k.D.y).mul(0.7));
  }
  col = mix(col, k.second.mul(0.8), v.E.z.mul(k.E.z).mul(0.2));
  col = mix(col, k.white.mul(0.96), smoothstep(0.25, 0.6, v.E.y.add(n.mul(0.15))).mul(k.E.x));
  // Bare skin: nose leather, lips, pads, eye rims.
  const pad = nosePad(k, v);
  const bareW = clamp(max(v.C.x.add(v.C.y).add(v.C.z).add(v.C.w), pad), 0, 1).toVar();
  const safe = max(bareW, 1e-3);
  let bare: N = mix(vec3(0.025, 0.02, 0.02), k.leather, clamp(v.C.x.div(safe), 0, 1));
  {
    // The detailed nose (coat noseColor set): a pebbled pad, comma-shaped nostrils and the philtrum.
    const q = v.F.xy;
    let leather: N = k.nose.rgb.mul(furNoise(v.pos.div(k.grain).mul(2600)).mul(0.4).add(0.8));
    leather = leather.mul(mix(1, 0.7, smoothstep(0.006, 0.014, length(q.mul(vec2(0.8, 1))))));
    let nostril: N = float(0);
    for (const s of [1, -1]) {
      const r0 = q.sub(vec2(s * 0.0062, -0.0012));
      const a = s * 0.75;
      const rx = r0.x.mul(Math.cos(a)).sub(r0.y.mul(Math.sin(a))), ry = r0.x.mul(Math.sin(a)).add(r0.y.mul(Math.cos(a)));
      const r = vec2(rx.add(ry.mul(ry).mul(120 * s)), ry);
      nostril = max(nostril, float(1).sub(smoothstep(0.75, 1.05, length(r.div(vec2(0.0016, 0.0042))))));
    }
    const philtrum = float(1).sub(smoothstep(0.0006, 0.0014, abs(q.x))).mul(smoothstep(-0.0035, -0.0065, q.y));
    leather = mix(leather, vec3(0.02, 0.012, 0.01), max(nostril, philtrum));
    const noseW = max(smoothstep(0, 0.6, v.C.x), pad);
    let detailed: N = mix(bare, k.nose.rgb.mul(0.22), clamp(v.C.y.div(safe), 0, 1));
    detailed = mix(detailed, leather, clamp(noseW.div(safe), 0, 1));
    bare = mix(bare, detailed, step(0.5, k.nose.w));
  }
  {
    // Chickens: horn beak, red comb and face, scaly legs.
    const beak = k.leather.mul(mix(1, 0.8, furNoise(v.pos.mul(300))));
    const row = v.pos.y.div(0.0042);
    const around = v.pos.x.add(v.pos.z).div(0.0052).add(mod(floor(row), 2).mul(0.5));
    const scales = max(furStripe(row, 0.07), furStripe(around, 0.06).mul(0.6));
    const shank = k.shank.mul(float(1).sub(scales.mul(0.22))).mul(furNoise(v.pos.mul(700)).mul(0.12).add(0.92));
    const comb = k.comb.mul(furNoise(v.pos.mul(900)).mul(0.3).add(0.82));
    const chick = beak.mul(v.C.x).add(shank.mul(v.C.z)).add(comb.mul(v.C.w)).add(bare.mul(v.C.y)).div(max(v.C.x.add(v.C.y).add(v.C.z).add(v.C.w), 1e-3));
    bare = mix(bare, chick, step(0.5, k.L.x));
  }
  col = mix(col, bare, bareW);
  return col.mul(mix(furStreak(p, v.flow), 0.5, k.L.x.mul(0.7)).mul(0.28).add(0.86));
}

/** Bare-skin weight (nose, lips, pads, eye rims): no fur, no sheen there. */
const bareOf = (k: Coat, v: Ch) => clamp(max(v.C.x.add(v.C.y).add(v.C.z).add(v.C.w), nosePad(k, v)), 0, 1);

/** The fur body's graph (one for every fur body). */
const bodyGraph = once(() => {
  const k = coatInputs(), v = channels();
  const col = Fn(() => {
    const c = furCoat(k, v).toVar();
    // Short-coated bodies under shells are a little darker (the shells add the light tips).
    return c.mul(mix(select(k.fur.x.greaterThan(0.002), float(0.75), float(0.9)), 1, bareOf(k, v)));
  })();
  const bare = bareOf(k, v);
  return {
    color: col,
    // The sheen takes the coat colour (dark coats don't turn pale), none on bare skin; wet nose and lips.
    sheen: vec3(0.6, 0.55, 0.5).mul(float(1).sub(bare)).mul(clamp(col.mul(2.5), 0, 1)),
    roughness: mix(0.85, 0.45, v.C.x),
    // Hair scatters light instead of mirroring it: little specular but on the nose.
    specular: mix(0.15, 1, v.C.x),
  };
});


/** Average strand coverage at shell height h (what the strands below cover when too small to resolve). */
const meanCover = (h: N) => {
  const m = pow(max(0, float(1).sub(h.div(0.78))), 2).mul(0.785);
  return float(1).sub(float(1).sub(m).mul(float(1).sub(m)));
};

/** The shell stack's graph (one for every animal's shells). */
const shellGraph = once(() => {
  const k = coatInputs(), v = channels();
  const shell = attribute("furShell", "float");
  // Out along the normal (more for fluffy coats), combed along the skinned flow, sagging a little.
  const position = Fn(() => {
    const nrm = normalize(normalLocal).toVar();
    const fl = skinnedFlow;
    const comb = fl.sub(nrm.mul(dot(fl, nrm)));
    const len = k.fur.x.mul(v.B.y).mul(float(1).add(k.E.w.mul(5).mul(smoothstep(0.55, 0.95, v.E.w)))).toVar();
    const h = shell;
    return positionLocal.add(nrm.mul(len).mul(h).mul(k.fur.y.mul(0.7).add(0.3))).add(comb.mul(len).mul(h).mul(float(1).sub(k.fur.y.mul(0.55)))).sub(vec3(0, 1, 0).mul(len).mul(h).mul(h).mul(0.3));
  })();
  const color = Fn(() => {
    const c = furCoat(k, v).toVar();
    // Darker near the skin (strands shade each other).
    c.mulAssign(mix(0.72, 1.06, shell));
    const g = v.pos.div(k.grain);
    {
      // Agouti: dark guard hair tips, strongest along the back.
      const tipBand = smoothstep(0.45, 0.8, shell).mul(smoothstep(0.3, 0.6, furStreak(g.add(0.37), v.flow)));
      const where = float(1).sub(v.D.y).mul(v.D.x.mul(0.65).add(0.35)).mul(float(1).sub(v.D.z.mul(0.7))).mul(float(1).sub(v.E.z.mul(step(0.01, k.E.z))));
      c.assign(mix(c, k.second.mul(0.6), tipBand.mul(where).mul(k.D.y).mul(0.75)));
    }
    {
      // Frost: white tips on some guard hairs.
      const tipBand = smoothstep(0.62, 0.9, shell).mul(smoothstep(0.45, 0.7, furStreak(g.add(1.91), v.flow)));
      c.assign(mix(c, k.white, tipBand.mul(float(1).sub(v.D.y)).mul(float(1).sub(v.E.y)).mul(k.E.y).mul(0.8)));
    }
    {
      // Squirrel tail: brown at the root, a dark band, a white tip.
      const t = v.E.z.mul(k.E.z);
      const band = smoothstep(0.1, 0.2, shell).mul(float(1).sub(smoothstep(0.3, 0.4, shell)));
      const tipW = smoothstep(0.34, 0.48, shell);
      c.assign(mix(c, k.second.mul(0.7), band.mul(t).mul(0.6)));
      c.assign(mix(c, k.white, tipW.mul(t).mul(furStreak(g.add(4.2), v.flow).mul(0.3).add(0.7))));
    }
    return c;
  })();
  const alpha = Fn(() => {
    // Strands: tapered, of random length, on two offset grids; thinner than a pixel they blend into their average.
    const fine = mix(1, max(v.B.y, 1), step(k.grain, 0.99).mul(0.6));
    const p = v.pos.div(k.fur.z.mul(fine)).toVar();
    const cov = float(0).toVar();
    for (const o of [0, 1]) {
      const q = p.add(o * 0.5);
      const c = floor(q), r = furHash(c.add(o * 31)).toVar();
      const tip = r.y.mul(0.45).add(0.55);
      const radius = float(1).sub(shell.div(tip)).mul(0.5);
      const d = length(fract(q).sub(0.25).sub(r.mul(0.5)));
      cov.assign(max(cov, smoothstep(radius, radius.sub(0.12), d).mul(step(shell, tip))));
    }
    const px = length(fwidth(p));
    const strands = mix(cov, meanCover(shell), smoothstep(0.5, 2, px));
    return strands.mul(float(1).sub(bareOf(k, v))).mul(step(0.0005, k.fur.x.mul(v.B.y)));
  })();
  return { position, color, alpha };
});

/** The body under the fur: coat colours, a soft sheen. */
export function createNodeFurMaterial(uniforms: FurUniforms): MeshPhysicalNodeMaterial {
  const g = bodyGraph();
  const mat = new MeshPhysicalNodeMaterial({ roughness: 0.85, sheen: 0.6, sheenRoughness: 0.7 });
  mat.colorNode = g.color;
  mat.sheenNode = g.sheen;
  mat.roughnessNode = g.roughness;
  mat.specularIntensityNode = g.specular;
  mat.userData.fur = true;
  return useNodeDqs(furInputs(mat, uniforms));
}

/** One draw for all shells (instanced by the `furShell` height). */
export function createNodeFurShellMaterial(uniforms: FurUniforms): MeshStandardNodeMaterial {
  const g = shellGraph();
  // Blended (inner shells first, as instanced), so thin strands fade instead of flickering.
  const mat = new MeshStandardNodeMaterial({ roughness: 1, transparent: true, depthWrite: false, alphaTest: 0.01 });
  mat.envMapIntensity = 0.7;
  mat.positionNode = g.position;
  mat.colorNode = g.color;
  mat.opacityNode = g.alpha;
  return useNodeDqs(furInputs(mat, uniforms));
}

/** Animal eye on a UV sphere whose v runs from the front pole: dark pupil, a large iris, a little sclera. */
const eyeGraph = once(() => {
  const iris = input("fur.iris", new THREE.Color()), markH = input("fur.H", new THREE.Vector4());
  return Fn(() => {
    const e = attribute("uv", "vec2");
    const r = e.y, slit = markH.w;
    const rays = sin(e.x.mul(6.2831 * 23)).mul(sin(e.x.mul(6.2831 * 7).add(r.mul(40)))).mul(0.15).add(0.85);
    const edge = mix(0.34, 0.44, slit);
    const ir = iris.mul(rays).mul(mix(1.3, 0.6, smoothstep(0.1, edge, r)));
    const a = e.x.mul(6.2831);
    const pupil = length(vec2(cos(a).mul(r).div(mix(0.1, 0.022, slit)), sin(a).mul(r).div(mix(0.1, 0.2, slit))));
    const c = mix(vec3(0.005, 0.005, 0.005), ir, smoothstep(0.9, 1.1, pupil)).toVar();
    c.assign(mix(c, vec3(0.03, 0.02, 0.015), smoothstep(edge.sub(0.01), edge.add(0.03), r)));
    c.assign(mix(c, vec3(0.2, 0.12, 0.08), smoothstep(edge.add(0.11), edge.add(0.21), r)));
    return c;
  })();
});

export function createNodeAnimalEyeMaterial(uniforms: FurUniforms): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial({ roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.376 });
  mat.colorNode = eyeGraph();
  return useNodeDqs(feed(mat, { "fur.iris": () => uniforms.uIris.value, "fur.H": () => uniforms.uMarkH.value }));
}

/** Tack (saddle, bridle, stirrups): leather, or steel for `metal`. Colours are linear. */
export function createNodeTackMaterial(color: [number, number, number] = [0.2, 0.1, 0.05], roughness = 0.5, metal = false): MeshStandardNodeMaterial {
  return useNodeDqs(new MeshStandardNodeMaterial({ color: new THREE.Color(...color), roughness, metalness: metal ? 0.9 : 0 }));
}

/** Whiskers: thin, slightly glossy hairs. */
export function createNodeWhiskerMaterial(color: [number, number, number] = [0.86, 0.84, 0.8]): MeshStandardNodeMaterial {
  return useNodeDqs(new MeshStandardNodeMaterial({ color: new THREE.Color().setRGB(...color, THREE.SRGBColorSpace), roughness: 0.35 }));
}

/**
 * Material kit for animal packs on WebGPURenderer: fur bodies, animal eyes,
 * tack and whiskers, everything else as in `nodeMaterials`. Pass it to
 * `ThreeActor`, then `addNodeFurShells`.
 */
export function animalNodeMaterials(uniforms: FurUniforms): ActorMaterialKit {
  return {
    ...nodeMaterials,
    mesh(data, actor) {
      const { kind } = data.def.material;
      if (kind === "fur") return createNodeFurMaterial(uniforms);
      if (kind === "eye" && data.def.tags?.includes("animal")) return createNodeAnimalEyeMaterial(uniforms);
      if (data.def.tags?.includes("whiskers")) return createNodeWhiskerMaterial(data.def.material.color);
      if (data.def.tags?.includes("tack") && kind === "other") return createNodeTackMaterial(data.def.material.color, data.def.material.roughness, data.def.tags.includes("metal"));
      return nodeMaterials.mesh(data, actor);
    },
  };
}

/** `addFurShells` (../fur.ts) with the node shell material. */
export function addNodeFurShells(actor: ThreeActor, uniforms: FurUniforms, shells = 16): FurShells[] {
  return addFurShellsWith(actor, () => createNodeFurShellMaterial(uniforms), shells);
}

