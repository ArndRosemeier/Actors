/**
 * TSL ports of the race skin patterns, painted stubble and eye shapes in
 * ../racepatterns.ts. Same maths, same uniforms; see that file for what each
 * pattern does and what space it lives in.
 */
import { Fn, If, abs, clamp, float, fwidth, length, max, min, mix, mx_hsvtorgb, mx_rgbtohsv, select, sin, step, texture, vec2, vec3 } from "./tsl";
import type { Texture } from "three";
import { fbm3, noise3, voronoi3 } from "./noise";
import type { N } from "./types";

/** smoothstep that also works with reversed edges on every backend (GLSL tolerates them, WGSL leaves them undefined). */
export const ss = Fn(([e0, e1, x]: N[]) => {
  const t = clamp(x.sub(e0).div(e1.sub(e0)), 0, 1);
  return t.mul(t).mul(t.mul(-2).add(3));
}).setLayout({ name: "h_ss", type: "float", inputs: [{ name: "e0", type: "float" }, { name: "e1", type: "float" }, { name: "x", type: "float" }] });

export interface PatternInputs {
  /** vec4: x id, y strength, z seed, w glow. */
  pattern: N;
  /** vec3 accent colour (linear). */
  accent: N;
  /** vec4: x ground offset, y body scale, z/w head joint height and depth. */
  bindInfo: N;
}

export interface PatternResult {
  color: N;
  /** Bump height (meters). */
  height: N;
  /** Roughness override, -1 = unchanged. */
  rough: N;
  emit: N;
}

/** The race skin pattern on colour `c0` at bind-pose position `bind`; `lips`, `nails` are region masks. */
export function skinPattern(c0: N, lips: N, nails: N, bind: N, u: PatternInputs): PatternResult {
  const c = vec3(c0).toVar();
  const height = float(0).toVar();
  const rough = float(-1).toVar();
  const emit = vec3(0).toVar();
  const pid = u.pattern.x, ps = u.pattern.y, seed = u.pattern.z;
  If(pid.greaterThan(0.5).and(ps.greaterThan(0)), () => {
    const acc = u.accent;
    const scale = max(0.3, u.bindInfo.y);
    const b = bind.div(scale).toVar();
    const hp = vec3(0, u.bindInfo.z, u.bindInfo.w).div(scale).toVar();
    const faceZone = ss(hp.y.sub(0.02), hp.y.add(0.04), b.y).mul(ss(0, -0.05, b.z.sub(hp.z))).toVar();
    If(pid.lessThan(1.5), () => {
      // Freckles: dense on the face, patches elsewhere.
      const v = voronoi3(b.mul(260).add(seed.mul(13))).toVar();
      const zone = max(faceZone, ss(0.55, 0.8, noise3(b.mul(3))).mul(0.6));
      const fr = float(1).sub(ss(0.12, 0.3, v.x)).mul(step(0.45, v.z)).mul(zone);
      c.assign(mix(c, c.mul(vec3(0.78, 0.6, 0.48)), fr.mul(ps)));
    })
      .ElseIf(pid.lessThan(2.5), () => {
        // Scales: Voronoi plates, finer on the face, lighter on the belly, none on lips and nails.
        const sc = mix(48, 95, faceZone).toVar();
        const v = voronoi3(b.mul(sc).add(seed.mul(5))).toVar();
        const aa = float(1).sub(ss(0.08, 0.35, length(fwidth(b.mul(sc))))).toVar();
        const edge = mix(0.75, ss(0, 0.18, v.y.sub(v.x)), aa).toVar();
        const dome = float(1).sub(v.x).mul(aa);
        const mask = ps.mul(float(1).sub(lips)).mul(float(1).sub(nails)).toVar();
        const plate = mix(acc, c, mix(0.5, v.z, aa).mul(0.45).add(0.45)).toVar();
        const belly = ss(0, -0.06, b.z).mul(ss(0.6, 1.2, b.y)).mul(float(1).sub(ss(1.35, 1.5, b.y))).mul(float(1).sub(faceZone));
        plate.assign(mix(plate, mix(c, acc, 0.5).mul(1.15), belly.mul(0.6)));
        c.assign(mix(c, mix(plate.mul(0.55), plate, edge), mask));
        height.addAssign(mask.mul(dome.mul(0.0009).add(edge.mul(0.0004))));
        rough.assign(mix(0.48, v.z.mul(0.2).add(0.32), mask));
      })
      .ElseIf(pid.lessThan(3.5), () => {
        // Bark: vertical ridged furrows warped by noise, knots, moss in the grooves.
        const q = b.mul(vec3(28, 6, 28)).add(seed.mul(3)).toVar();
        const warp = fbm3(q.mul(0.5)).mul(2);
        const ridge = abs(sin(b.x.mul(70).add(b.z.mul(55)).add(warp.mul(3)).add(noise3(q).mul(2)))).toVar();
        const groove = float(1).sub(ss(0, 0.35, ridge)).toVar();
        const m = ps.mul(float(1).sub(faceZone.mul(0.55))).mul(float(1).sub(lips)).toVar();
        const knots = ss(0.75, 0.9, noise3(b.mul(12).add(4))).toVar();
        c.assign(mix(c, acc, m.mul(max(groove.mul(0.85), knots.mul(0.5)))));
        const moss = ss(0.55, 0.75, fbm3(b.mul(9).add(9))).mul(groove);
        c.assign(mix(c, vec3(0.013, 0.033, 0.005), m.mul(moss).mul(0.6)));
        height.addAssign(m.mul(ridge.mul(0.0016).sub(knots.mul(0.001))));
        rough.assign(mix(0.48, 0.82, m));
      })
      .ElseIf(pid.lessThan(4.5), () => {
        // Spots: irregular blotches.
        const sp = ss(0.55, 0.62, fbm3(b.mul(7).add(seed.mul(11))));
        c.assign(mix(c, mix(c, acc, 0.75), sp.mul(ps).mul(float(1).sub(lips))));
      })
      .ElseIf(pid.lessThan(5.5), () => {
        // Tattoos: crisp tribal bands.
        const bands = abs(sin(b.y.mul(34).add(fbm3(b.mul(5).add(seed)).mul(6))));
        const zone = ss(0.35, 0.6, noise3(b.mul(2.2).add(seed.mul(2)))).mul(float(1).sub(lips));
        const ink = float(1).sub(ss(0.15, 0.22, bands)).mul(zone);
        c.assign(mix(c, c.mul(mix(vec3(0.03, 0.04, 0.08), acc.mul(0.6), 0.3)), ink.mul(ps)));
      })
      .ElseIf(pid.lessThan(6.5), () => {
        // Veins: branching lines that glow.
        const v1 = abs(fbm3(b.mul(14).add(seed)).sub(0.5));
        const v2 = abs(fbm3(b.mul(31).add(seed.mul(2))).sub(0.5));
        const vein = float(1).sub(ss(0, 0.025, v1)).add(float(1).sub(ss(0, 0.018, v2)).mul(0.5)).toVar();
        vein.mulAssign(ps.mul(float(1).sub(lips)).mul(float(1).sub(faceZone.mul(0.5)).mul(0.4).add(0.6)));
        c.assign(mix(c, acc.mul(0.7), clamp(vein, 0, 1).mul(0.7)));
        emit.addAssign(acc.mul(vein).mul(u.pattern.w).mul(0.8));
        height.addAssign(vein.mul(0.0002));
      })
      .ElseIf(pid.lessThan(7.5), () => {
        // Stripes: warped bands around the body.
        const s = sin(b.y.mul(26).add(fbm3(b.mul(4).add(seed)).mul(7)).add(b.x.mul(4)));
        const st = ss(0.55, 0.75, s).mul(ss(0.3, 0.6, noise3(b.mul(3).add(2))));
        c.assign(mix(c, acc, st.mul(ps).mul(float(1).sub(lips)).mul(float(1).sub(faceZone.mul(0.4)))));
      })
      .Else(() => {
        // Crystals: faceted mineral patches with glints.
        const v = voronoi3(b.mul(60).add(seed.mul(3))).toVar();
        const patchM = ss(0.58, 0.68, fbm3(b.mul(5).add(seed.mul(8)))).mul(ps).mul(float(1).sub(lips)).toVar();
        c.assign(mix(c, acc.mul(v.z.mul(0.4).add(0.6)), patchM));
        height.addAssign(patchM.mul(float(1).sub(v.x).mul(0.0012).add(v.z.mul(0.0006))));
        rough.assign(mix(0.48, 0.18, patchM));
        emit.addAssign(acc.mul(patchM).mul(u.pattern.w).mul(0.3));
      });
  });
  return { color: c, height, rough, emit };
}

/** Beard coverage 0..1 at face coordinates f (see GLSL_STUBBLE). */
export const beardCoverage = Fn(([style, f]: N[]) => {
  const ax = abs(f.x).toVar();
  const cheek = ss(0.35, 1.25, ax).mul(0.62).sub(0.82).toVar();
  const upper = float(1).sub(ss(cheek.sub(0.06), cheek.add(0.06), f.y));
  const side = ss(-1.45, -1.05, f.z).toVar();
  const neck = ss(-2.25, -1.95, f.y.add(ax.mul(0.25))).mul(float(1).sub(ss(1.3, 1.6, ax)));
  const front = upper.mul(side).mul(neck).toVar();
  const lipZone = ss(0.38, 0.5, length(vec2(f.x.div(1.1), f.y.add(1.18).div(0.36)))).toVar();
  const mustache = float(1).sub(ss(0.5, 0.62, ax)).mul(ss(-1.12, -1.02, f.y)).mul(float(1).sub(ss(-0.86, -0.78, f.y))).mul(side).toVar();
  const chin = float(1).sub(ss(0.42, 0.56, ax)).mul(float(1).sub(ss(-1.36, -1.28, f.y))).mul(ss(-2.1, -1.95, f.y));
  return select(
    style.lessThan(0.5),
    max(front.mul(lipZone), mustache),
    select(
      style.lessThan(1.5),
      max(chin, mustache).mul(side),
      select(style.lessThan(2.5), mustache, select(style.lessThan(3.5), front.mul(ss(0.5, 0.75, ax)).mul(lipZone), front.mul(ss(-1.75, -1.6, f.y.negate().sub(ax.mul(0.18)))).mul(lipZone))),
    ),
  );
}).setLayout({ name: "h_beardCoverage", type: "float", inputs: [{ name: "style", type: "float" }, { name: "f", type: "vec3" }] });

/** Painted stubble over colour c (see GLSL_STUBBLE). */
export function stubble(c: N, lips: N, bind: N, face: N, amount: N, color: N): N {
  const out = vec3(c).toVar();
  If(amount.x.greaterThan(0).and(face.w.greaterThan(0)), () => {
    const f = bind.sub(face.xyz).div(face.w).mul(vec3(1, 1, -1)).toVar(); // vBind has +Z back; face coordinates have +Z forward
    const cov = beardCoverage(amount.y, f).mul(float(1).sub(lips)).toVar();
    If(cov.greaterThan(0), () => {
      const dots = ss(0.42, 0.68, noise3(f.mul(160).add(amount.z.mul(17)))).mul(0.7).add(ss(0.6, 0.8, noise3(f.mul(310).add(3.1))).mul(0.3));
      const shade = cov.mul(amount.x).toVar();
      out.assign(mix(out, out.mul(mix(vec3(1), color.mul(3).add(0.25), 0.6)), shade.mul(0.65)));
      out.assign(mix(out, color, min(1, shade.mul(dots).mul(1.1))));
    });
  });
  return out;
}

export interface EyeInputs {
  hue: N;
  sat: N;
  light: N;
  /** vec4: x pupil shape, y dilation, z glow. */
  pupil: N;
}

/** Iris colour: hue/saturation/lightness shift of the saturated (iris) pixels. */
export function eyeShift(c: N, u: EyeInputs): N {
  const hsv = mx_rgbtohsv(c).toVar();
  const iris = ss(0.18, 0.4, hsv.y);
  const shifted = mx_hsvtorgb(vec3(u.hue, clamp(hsv.y.mul(u.sat), 0, 1), clamp(hsv.z.mul(u.light), 0, 1)));
  return mix(c, shifted, iris.mul(step(0, u.hue)));
}

/** The eye's colour and glow (see GLSL_EYE): shifted iris, chosen pupil shape. `map` is MakeHuman's eye atlas. */
export function eyeColor(map: Texture, uvNode: N, u: EyeInputs): { color: N; emit: N } {
  const base = eyeShift(texture(map, uvNode).rgb, u);
  const col = vec3(base).toVar();
  const emit = vec3(0).toVar();
  const c0 = vec2(0.7025, 0.6971), c1 = vec2(0.2866, 0.285);
  const cc = select(length(uvNode.sub(c0)).lessThan(length(uvNode.sub(c1))), c0, c1).toVar();
  const IRIS = 0.115;
  const q = uvNode.sub(cc).div(IRIS).toVar();
  const r = length(q).toVar();
  const iris = float(1).sub(ss(0.92, 1, r)).toVar();
  If(u.pupil.x.greaterThan(0.5), () => {
    // Paint the photo's round pupil over with iris colour from the ring outside it.
    const dir = select(r.greaterThan(1e-3), q.div(max(r, 1e-3)), vec2(1, 0));
    const ring = cc.add(dir.mul(IRIS * 0.62));
    const irisCol = eyeShift(texture(map, ring).rgb, u);
    const oldPupil = float(1).sub(ss(0.36, 0.5, r));
    col.assign(mix(col, irisCol, oldPupil));
    const pr = u.pupil.y.mul(0.15).add(0.32).toVar();
    const slit = float(1).sub(ss(0.9, 1.05, length(vec2(q.x.div(pr.mul(0.28)), q.y.div(pr.mul(2.2))))));
    const goat = float(1).sub(ss(0.9, 1.05, abs(q.x).div(pr.mul(1.7)))).mul(float(1).sub(ss(0.9, 1.05, abs(q.y).div(pr.mul(0.45)))));
    const pupil = select(u.pupil.x.lessThan(1.5), slit, select(u.pupil.x.lessThan(2.5), goat, float(0))).toVar();
    col.assign(mix(col, vec3(0.006), pupil.mul(iris)));
    emit.assign(col.mul(iris).mul(float(1).sub(pupil)).mul(u.pupil.z).mul(2.5));
  }).Else(() => {
    const pupil = float(1).sub(ss(0.36, 0.5, r));
    emit.assign(col.mul(iris).mul(float(1).sub(pupil)).mul(u.pupil.z).mul(2.5));
  });
  return { color: col, emit };
}
