/**
 * Dual-quaternion skinning for node materials (the TSL twin of ../dqs.ts).
 *
 * three's node materials skin by blending bone matrices (linear blend
 * skinning), which pinches elbows, knees and shoulders. `useNodeDqs` replaces
 * the material's vertex position setup with one that blends the bones'
 * rotations as dual quaternions; morph targets and `positionNode` still apply
 * as usual (morphs before skinning, positionNode after).
 *
 * The shadow pass draws with three's own depth material, so shadows are
 * skinned with linear blending; the difference at the joints is far below a
 * shadow map's resolution.
 */
import { Fn, If, OnObjectUpdate, attribute, cross, dot, float, morphReference, normalLocal, normalize, positionLocal, property, reference, referenceBuffer, select, skinning, sqrt, subBuild, uniform, vec4 } from "./tsl";
import type { Material, Object3D, Skeleton, SkinnedMesh } from "three";
import { morphAttribute } from "../morphs";
import type { N } from "./types";

/** Unit quaternion of a rotation matrix's upper 3x3 (columns c0, c1, c2). */
const quatOf = Fn(([c0, c1, c2]: N[]) => {
  const q = vec4(0, 0, 0, 1).toVar();
  const tr = c0.x.add(c1.y).add(c2.z).toVar();
  If(tr.greaterThan(0), () => {
    const s = sqrt(tr.add(1)).mul(2).toVar();
    q.assign(vec4(c1.z.sub(c2.y).div(s), c2.x.sub(c0.z).div(s), c0.y.sub(c1.x).div(s), s.mul(0.25)));
  })
    .ElseIf(c0.x.greaterThan(c1.y).and(c0.x.greaterThan(c2.z)), () => {
      const s = sqrt(float(1).add(c0.x).sub(c1.y).sub(c2.z)).mul(2).toVar();
      q.assign(vec4(s.mul(0.25), c1.x.add(c0.y).div(s), c2.x.add(c0.z).div(s), c1.z.sub(c2.y).div(s)));
    })
    .ElseIf(c1.y.greaterThan(c2.z), () => {
      const s = sqrt(float(1).add(c1.y).sub(c0.x).sub(c2.z)).mul(2).toVar();
      q.assign(vec4(c1.x.add(c0.y).div(s), s.mul(0.25), c2.y.add(c1.z).div(s), c2.x.sub(c0.z).div(s)));
    })
    .Else(() => {
      const s = sqrt(float(1).add(c2.z).sub(c0.x).sub(c1.y)).mul(2).toVar();
      q.assign(vec4(c2.x.add(c0.z).div(s), c2.y.add(c1.z).div(s), s.mul(0.25), c0.y.sub(c1.x).div(s)));
    });
  return normalize(q);
}).setLayout({ name: "dqs_quat", type: "vec4", inputs: [{ name: "c0", type: "vec3" }, { name: "c1", type: "vec3" }, { name: "c2", type: "vec3" }] });

/** Quaternion product a * b. */
const quatMul = Fn(([a, b]: N[]) => vec4(a.w.mul(b.xyz).add(b.w.mul(a.xyz)).add(cross(a.xyz, b.xyz)), a.w.mul(b.w).sub(dot(a.xyz, b.xyz)))).setLayout({
  name: "dqs_mul",
  type: "vec4",
  inputs: [{ name: "a", type: "vec4" }, { name: "b", type: "vec4" }],
});

/** Rotates v by unit quaternion r. */
const quatRotate = Fn(([r, v]: N[]) => v.add(cross(r.xyz, cross(r.xyz, v).add(r.w.mul(v))).mul(2))).setLayout({
  name: "dqs_rotate",
  type: "vec3",
  inputs: [{ name: "r", type: "vec4" }, { name: "v", type: "vec3" }],
});

const skeletonsUpdated = new WeakMap<Skeleton, number>();

/** Dual-quaternion version of three's `skinning(object)`: transforms positionLocal and normalLocal in place. */
const dqSkinning = Fn(([mesh]: [SkinnedMesh], builder: N) => {
  const skeleton = mesh.skeleton;
  // Small skeletons live in a uniform buffer; anything larger falls back to three's own skinning (bone texture).
  if (skeleton.bones.length * 64 > builder.getUniformBufferLimit()) {
    skinning(mesh);
    return;
  }
  const skinIndex = attribute("skinIndex", "uvec4");
  const skinWeight = attribute("skinWeight", "vec4");
  const bindMatrix = reference("bindMatrix", "mat4");
  const bindMatrixInverse = reference("bindMatrixInverse", "mat4");
  const bones = referenceBuffer("skeleton.boneMatrices", "mat4", skeleton.bones.length);
  OnObjectUpdate(({ object, frameId }: { object: SkinnedMesh; frameId: number }) => {
    const sk = object.skeleton;
    if (skeletonsUpdated.get(sk) !== frameId) {
      skeletonsUpdated.set(sk, frameId);
      sk.update();
    }
  });
  const real: N[] = [], dual: N[] = [];
  for (const k of ["x", "y", "z", "w"]) {
    const m = bones.element(skinIndex[k]).toVar();
    const c0 = m.element(0), c1 = m.element(1), c2 = m.element(2), c3 = m.element(3);
    const r = quatOf(c0.xyz, c1.xyz, c2.xyz).toVar();
    real.push(r);
    dual.push(quatMul(vec4(c3.xyz, 0), r).mul(0.5).toVar());
  }
  // Keep all rotations in the hemisphere of the first before blending.
  const sign = (i: number) => select(dot(real[0], real[i]).lessThan(0), float(-1), float(1));
  const w = skinWeight;
  const wr = [w.x, w.y.mul(sign(1)), w.z.mul(sign(2)), w.w.mul(sign(3))];
  const dqR = real[0].mul(wr[0]).add(real[1].mul(wr[1])).add(real[2].mul(wr[2])).add(real[3].mul(wr[3])).toVar();
  const dqD = dual[0].mul(wr[0]).add(dual[1].mul(wr[1])).add(dual[2].mul(wr[2])).add(dual[3].mul(wr[3])).toVar();
  const len = dqR.length().toVar();
  dqR.divAssign(len);
  dqD.divAssign(len);
  const t = dqR.w.mul(dqD.xyz).sub(dqD.w.mul(dqR.xyz)).add(cross(dqR.xyz, dqD.xyz)).mul(2).toVar();
  const p = bindMatrix.mul(vec4(positionLocal, 1)).xyz;
  positionLocal.assign(bindMatrixInverse.mul(vec4(quatRotate(dqR, p).add(t), 1)).xyz);
  if (builder.hasGeometryAttribute("normal")) {
    const n = bindMatrix.mul(vec4(normalLocal, 0)).xyz;
    normalLocal.assign(bindMatrixInverse.mul(vec4(quatRotate(dqR, n), 0)).xyz);
  }
  // A fur's comb direction turns with the skin (read by the fur shells as `skinnedFlow`).
  if (builder.hasGeometryAttribute("furFlow")) {
    const f = bindMatrix.mul(vec4(attribute("furFlow", "vec3"), 0)).xyz;
    skinnedFlow.assign(bindMatrixInverse.mul(vec4(quatRotate(dqR, f), 0)).xyz);
  }
}, "void");

/** The `furFlow` attribute turned with the skin (set by dual-quaternion skinning, in the vertex stage). */
export const skinnedFlow: N = property("vec3", "actorSkinnedFlow");

/**
 * Face morphs carried as plain attributes (see ../morphs.ts): each channel's
 * deltas times the drawn mesh's `morphTargetInfluences`, before skinning.
 */
function attributeMorphs(builder: N): void {
  for (let k = 0; builder.hasGeometryAttribute(morphAttribute(k)); k++) {
    const weight = uniform(0).onObjectUpdate(({ object }: { object: Object3D & { morphTargetInfluences?: number[] } }) => object.morphTargetInfluences?.[k] ?? 0);
    positionLocal.addAssign(attribute(morphAttribute(k), "vec3").mul(weight));
    if (builder.hasGeometryAttribute(morphAttribute(k, true))) normalLocal.addAssign(attribute(morphAttribute(k, true), "vec3").mul(weight));
  }
}

/** Makes a node material skin with dual quaternions (see the file comment). Returns the material. */
export function useNodeDqs<T extends Material>(material: T): T {
  const m = material as unknown as { setupPosition(builder: N): N; positionNode: N; displacementMap?: unknown };
  m.setupPosition = function (this: typeof m, builder: N) {
    const { object, geometry } = builder;
    if (geometry.morphAttributes.position || geometry.morphAttributes.normal || geometry.morphAttributes.color) morphReference(object);
    attributeMorphs(builder);
    if (object.isSkinnedMesh === true) dqSkinning(object);
    if (this.positionNode !== null) positionLocal.assign(subBuild(this.positionNode, "POSITION", "vec3"));
    return positionLocal;
  };
  return material;
}
