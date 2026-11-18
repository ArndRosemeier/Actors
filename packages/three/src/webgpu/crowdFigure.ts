/**
 * The crowd figures' material (see ../crowdFigure.ts): one node material for every kind of a
 * `CrowdFigures`, so all of them share one shader. Per draw it reads the drawn kind's first
 * instance row and hair textures from the mesh (`mesh.userData.crowdFigure`), which holds in the
 * shadow pass too (three draws shadows with its own material, but the same mesh).
 *
 * Vertex stage, per man (instance): his row of the instance texture gives his placement, his two
 * poses (clip frames and the share between them, plus a fading pose and its weight), his opacity,
 * colours and the pieces he shows. Each vertex is skinned from the pose atlas with linear blending
 * (the crowd level's skinning), placed, and collapsed to a point when its piece is hidden.
 * Fragment stage: hems and hair cards are cut, and a dither cuts away the share a fade hides.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { Fn, If, attribute, dFdx, dFdy, dot, faceDirection, exp2, float, floor, fract, int, instanceIndex, ivec2, mod, normalGeometry, normalLocal, normalize, positionGeometry, positionLocal, screenCoordinate, select, sRGBTransferEOTF, texture, uniform, uv, varying, vec2, vec3, vec4 } from "./tsl";
import { CROWD_ATLAS_ROWS, CROWD_HAIR_MAPS, CROWD_ROW, CROWD_SLOT, type CrowdFigures, type CrowdKind } from "../crowdFigure";
import type { N } from "./types";

const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  // Filterable, as the hair maps it stands in for: three picks how to sample (and whether to bind a sampler) from it at build time.
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
})();

/** Alpha below which a hair card's texel is cut (as the crowd level's hair). */
const HAIR_CUT = 0.35;

type Frame = { object?: THREE.Object3D | null };
const kindOf = (frame: Frame) => frame.object?.userData.crowdFigure as CrowdKind | undefined;

/** A texture of the drawn kind (`pick`), sampled at `at`; `fallback` while it has none. */
function kindTexture(name: string, pick: (kind: CrowdKind) => THREE.Texture | undefined, at: N): N {
  const node = texture(white, at).onObjectUpdate((frame: Frame) => {
    const kind = kindOf(frame);
    return (kind && pick(kind)) ?? white;
  });
  // three merges texture uniforms by their texture's uuid at build time: keep the four hair slots apart.
  (node as unknown as { getUniformHash: () => string }).getUniformHash = () => `crowdFigure:${name}`;
  return node;
}

/**
 * The material of `figures` (pass it as `CrowdFiguresOptions.material`):
 * `new CrowdFigures({ material: createNodeCrowdFigureMaterial })`.
 */
export function createNodeCrowdFigureMaterial(figures: CrowdFigures): MeshStandardNodeMaterial {
  const atlas = texture(figures.atlas);
  const rows = texture(figures.instances);
  const first = uniform(0).onObjectUpdate((frame: Frame) => kindOf(frame)?.first ?? 0);

  // This man's row (instance index within the kind, plus the kind's first row).
  const man = int(instanceIndex).add(int(first));
  const row = (k: number): N => rows.load(ivec2(k, man));
  const info = attribute("crowdFigure", "vec4");

  /** Row r (0..2) of bone j's matrix in atlas frame f. */
  const boneRow = (f: N, j: N, r: number): N => atlas.load(ivec2(j.mul(3).add(r), mod(f, CROWD_ATLAS_ROWS))).depth(f.div(CROWD_ATLAS_ROWS));

  /** Skins, places and hides the figure's vertex; with `normals`, also turns its normal (else: the shadow pass). */
  const skin = (normals: boolean) =>
    Fn(() => {
      // Pieces the man does not show (bit part-1 of his mask) collapse to a point, unskinned: their triangles draw nothing.
      const part = info.y;
      const mask = row(CROWD_ROW.skin).w;
      const shown = part.lessThan(0.5).or(mod(floor(mask.div(exp2(part.sub(1)))), 2).greaterThan(0.5));
      const out = vec3(0).toVar(), turned = vec3(0, 1, 0).toVar();
      If(shown, () => {
        const pa = row(CROWD_ROW.poseA).toVar(), pb = row(CROWD_ROW.poseB).toVar();
        const fa0 = int(pa.x.add(0.5)).toVar(), fa1 = int(pa.y.add(0.5)).toVar();
        const fb0 = int(pb.x.add(0.5)).toVar(), fb1 = int(pb.y.add(0.5)).toVar();
        // pa.z, pb.z: share of the next frame; pa.w: weight of the pose fading out (pose B).
        const wB = pa.w.toVar();
        const wA0 = float(1).sub(pa.z).mul(float(1).sub(wB)).toVar(), wA1 = pa.z.mul(float(1).sub(wB)).toVar();
        const wB0 = float(1).sub(pb.z).mul(wB).toVar(), wB1 = pb.z.mul(wB).toVar();
        const joints = attribute("skinIndex", "uvec4"), weights = attribute("skinWeight", "vec4");
        const p = vec4(positionGeometry, 1).toVar(), n = vec4(normalGeometry, 0).toVar();
        const pos = vec3(0).toVar(), nor = vec3(0).toVar();
        for (const k of ["x", "y", "z", "w"]) {
          const w = weights[k];
          If(w.greaterThan(0), () => {
            const j = int(joints[k]).toVar();
            const m = [0, 1, 2].map((r) => boneRow(fa0, j, r).mul(wA0).add(boneRow(fa1, j, r).mul(wA1)).toVar());
            If(wB.greaterThan(0), () => {
              for (let r = 0; r < 3; r++) m[r].addAssign(boneRow(fb0, j, r).mul(wB0).add(boneRow(fb1, j, r).mul(wB1)));
            });
            pos.addAssign(vec3(dot(m[0], p), dot(m[1], p), dot(m[2], p)).mul(w));
            if (normals) nor.addAssign(vec3(dot(m[0], n), dot(m[1], n), dot(m[2], n)).mul(w));
          });
        }
        const r0 = row(CROWD_ROW.matrix).toVar(), r1 = row(CROWD_ROW.matrix + 1).toVar(), r2 = row(CROWD_ROW.matrix + 2).toVar();
        const at = vec4(pos, 1);
        out.assign(vec3(dot(r0, at), dot(r1, at), dot(r2, at)));
        if (normals) {
          const nt = vec4(nor, 0);
          turned.assign(normalize(vec3(dot(r0, nt), dot(r1, nt), dot(r2, nt))));
        }
      });
      if (normals) normalLocal.assign(turned);
      return out;
    });

  // Colour: the baked one (sRGB bytes), or the man's skin, hair or garment-group colour.
  const slot = info.x;
  const baked = sRGBTransferEOTF(attribute("color", "vec4").rgb);
  const colour = (s: number, k: number, prev: N) => select(slot.greaterThan(s - 0.5).and(slot.lessThan(s + 0.5)), row(k).rgb, prev);
  let col: N = baked;
  col = colour(CROWD_SLOT.skin, CROWD_ROW.skin, col);
  col = colour(CROWD_SLOT.hair, CROWD_ROW.hair, col);
  for (let t = 0; t < 3; t++) col = colour(CROWD_SLOT.tint + t, CROWD_ROW.tints + t, col);
  // Drawn from both sides (inward-wound pieces such as buttons and neckerchief tails show too); insides are dark.
  const colorNode = vec4(select(faceDirection.greaterThan(0), varying(col), vec3(0.05, 0.03, 0.03)), 1);

  // Cuts: hems (interpolated hem value below 0), hair cards by their texture's alpha, and the fade's dither.
  const uvS = uv();
  const hair = info.w;
  // Only hair fragments sample, and only their own texture (explicit gradients: allowed inside the branch).
  const gx = dFdx(uvS).toVar(), gy = dFdy(uvS).toVar();
  const maps = Array.from({ length: CROWD_HAIR_MAPS }, (_, i) => {
    const map = kindTexture(`hair${i + 1}`, (kind) => kind.hairMaps[i], uvS);
    // Set in place: `.grad()` clones the node and the clone loses its uniform hash.
    (map as unknown as { gradNode: N[] }).gradNode = [gx, gy];
    return map;
  });
  const alpha = Fn(() => {
    const a = float(1).toVar();
    If(hair.greaterThan(0.5), () => {
      for (let h = 1; h <= CROWD_HAIR_MAPS; h++) {
        If(hair.greaterThan(h - 0.5).and(hair.lessThan(h + 0.5)), () => {
          a.assign(maps[h - 1].a);
        });
      }
    });
    return a;
  })();
  const opacity = varying(row(CROWD_ROW.poseB).w);
  // Interleaved gradient noise: a steady screen-space pattern, so a half-faded man is every other pixel, not a flicker.
  const noise = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
  const mask = info.z.greaterThanEqual(0).and(alpha.greaterThanEqual(HAIR_CUT)).and(noise.lessThan(opacity));

  const mat = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  mat.colorNode = colorNode;
  (mat as unknown as { maskNode: N }).maskNode = mask;
  const main = skin(true), shadow = skin(false);
  const m = mat as unknown as { setupPosition(builder: N): N; castShadowPositionNode: N };
  m.setupPosition = function () {
    positionLocal.assign(main());
    return positionLocal;
  };
  m.castShadowPositionNode = shadow();
  // CrowdFigures swaps the atlas texture when builds are added: this node follows.
  mat.userData.crowdAtlas = atlas;
  mat.name = "crowd figure";
  return mat;
}
