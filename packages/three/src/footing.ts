import * as THREE from "three";

/** The height of the ground at a world x/z (the host's own terrain, floors, steps). */
export type GroundHeight = (x: number, z: number) => number;

export interface FootingOptions {
  /** Most the body may lean to the ground's plane, radians (default 0.5, about 29 degrees). */
  maxTilt?: number;
  /** Most a foot may be moved by the leg bones, as a share of the body's height (default 0.3). */
  reach?: number;
  /** Bones moved per leg, counted from the foot up (default 3). */
  chain?: number;
  /** Most each of those bones may turn from the animation's pose, radians (default 0.7, about 40 degrees). */
  bend?: number;
}

/** Words in a bone's name (split at separators and camel case) that say it is not a foot: tails, heads, horns, helpers. */
const NOT_FEET = new Set("tail ik target ref helper twist ear ears tongue jaw lip lips trunk eye eyes wing wings feather feathers head neck horn horns antler antlers snout nose beak mouth".split(" "));
const notFoot = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).some((w) => NOT_FEET.has(w));

/** How the pass reads a foot, for tests and tools. */
export interface FootReading {
  /** Where the sole is now (world). */
  x: number;
  y: number;
  z: number;
  /** The ground there. */
  ground: number;
  /** 1: standing on the ground (as the animation has it), 0: lifted in a step. */
  planted: number;
}

interface Probe {
  mesh: THREE.SkinnedMesh;
  index: number;
  /** The bone that carries most of this skin point (-1: unknown). */
  bone: number;
  /** Where the point is in the rest pose, in the model's frame. */
  rest: THREE.Vector3;
  /** How far above the lowest sole it stands at rest (the model's frame). */
  height: number;
}

interface Foot {
  probes: Probe[];
  /** The bone the leg turns about the foot of (-1: none, the foot only lifts the body). */
  bone: number;
  /** Where each point is now (world) and how far it must rise to stand on the ground; filled by every reading. */
  at: THREE.Vector3[];
  need: number[];
}

const up = new THREE.Vector3(0, 1, 0);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Keeps an animal's feet on the ground, whatever its size, deform or clip: a pass that runs after the pose of every frame.
 * The soles are found in the skin (the lowest points of the rest pose, grouped into feet). Each frame the body leans to the plane
 * through the planted feet, is lifted so none sinks, and each leg's bones (a short chain from the foot up) reach so its sole meets the
 * ground height the host reports, within limits. Flying and swimming animals simply don't get a ground.
 * Made by `LibraryAnimal.setGround`.
 */
export class FootGrounding {
  private readonly feet: Foot[] = [];
  private readonly bones: THREE.Bone[] = [];
  private readonly basePos: THREE.Vector3;
  private readonly baseQuat: THREE.Quaternion;
  private readonly size = new THREE.Vector3();
  private readonly options: Required<FootingOptions>;
  /** The pose the animation gave the bones the pass has turned: put back before the next animation step. */
  private readonly turned = new Map<THREE.Bone, THREE.Quaternion>();
  private lift = NaN;
  private lean = new THREE.Vector2();
  /** What the last frame saw. */
  readonly readings: FootReading[] = [];
  /** Whether feet were found (false: the animal is not touched). */
  readonly active: boolean;

  /**
   * @param body puts the body's pose of the rest pose on the bones (the deform's scales); the pass measures the rest pose with it.
   */
  constructor(private readonly model: THREE.Object3D, body: () => void, options: FootingOptions = {}) {
    this.options = { maxTilt: options.maxTilt ?? 0.5, reach: options.reach ?? 0.3, chain: options.chain ?? 3, bend: options.bend ?? 0.7 };
    this.basePos = model.position.clone();
    this.baseQuat = model.quaternion.clone();
    this.active = this.build(body);
  }

  /** The tilt of the body is back at the animation's and the bones are as the animation left them. */
  restore(): void {
    this.beforeAnimate();
    this.model.position.copy(this.basePos);
    this.model.quaternion.copy(this.baseQuat);
    this.lift = NaN;
    this.lean.set(0, 0);
    this.model.updateMatrixWorld(true);
  }

  /** Call before the animation step: puts back the bones the last pass turned (an animation only sets the bones it has keys for). */
  beforeAnimate(): void {
    for (const [bone, q] of this.turned) bone.quaternion.copy(q);
    this.turned.clear();
  }

  /** The body's orientation without the lean (what `model.quaternion` would be without a ground). */
  get orientation(): THREE.Quaternion {
    return this.baseQuat;
  }

  /** Measures the rest pose, picks the soles and groups them into feet. */
  private build(body: () => void): boolean {
    const meshes: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
    if (!meshes.length) return false;
    const skeleton = meshes[0].skeleton;
    this.bones.push(...skeleton.bones);
    // The rest pose, with the deform's scales: the bones are put back as they were afterwards.
    const saved = this.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
    skeleton.pose();
    body();
    this.model.updateMatrixWorld(true);
    const toModel = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const rests: Float32Array[] = [], boneOf: Int32Array[] = [];
    let low = Infinity, high = -Infinity;
    const box = new THREE.Box3();
    const leaf = this.leafDistance(skeleton.bones);
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute("position"), idx = mesh.geometry.getAttribute("skinIndex"), w = mesh.geometry.getAttribute("skinWeight");
      const rest = new Float32Array((pos?.count ?? 0) * 3), bone = new Int32Array(pos?.count ?? 0).fill(-1);
      rests.push(rest);
      boneOf.push(bone);
      if (!pos) continue;
      toModel.copy(this.model.matrixWorld).invert().multiply(mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        mesh.getVertexPosition(i, v).applyMatrix4(toModel).toArray(rest, i * 3);
        low = Math.min(low, v.y);
        high = Math.max(high, v.y);
        box.expandByPoint(v);
        if (!idx || !w) continue;
        let best = 0;
        for (let k = 0; k < 4; k++) if (w.getComponent(i, k) > best) (best = w.getComponent(i, k)), (bone[i] = idx.getComponent(i, k));
      }
    }
    this.bones.forEach((b, i) => {
      b.position.copy(saved[i][0]);
      b.quaternion.copy(saved[i][1]);
      b.scale.copy(saved[i][2]);
    });
    this.model.updateMatrixWorld(true);
    if (!(high > low)) return false;
    box.getSize(this.size);
    const tall = high - low;
    const all: Probe[] = [];
    meshes.forEach((mesh, m) => {
      for (let i = 0; i < boneOf[m].length; i++) {
        if (rests[m][i * 3 + 1] > low + 0.06 * tall) continue;
        all.push({ mesh, index: i, bone: boneOf[m][i], rest: new THREE.Vector3().fromArray(rests[m], i * 3), height: 0 });
      }
    });
    if (!all.length) return false;
    // Soles: the skin within a hand of the lowest point, on bones within reach of a foot; with no such bones, the lowest skin alone.
    const near = all;
    const onFeet = near.filter((p) => p.bone >= 0 && leaf[p.bone] <= 3 && !notFoot(this.bones[p.bone].name));
    const soles = (onFeet.length ? onFeet : near.map((p) => ({ ...p, bone: -1 }))).sort((a, b) => a.rest.y - b.rest.y).slice(0, 96);
    if (!soles.length) return false;
    for (const p of soles) p.height = p.rest.y - low;
    // Feet: soles whose bones touch in the skeleton (the same bone, parent and child, or siblings: a foot and its toes) are one foot;
    // soles with no bone to go by group by their place on the ground (within a tenth of the animal's size).
    const near2 = 0.1 * Math.max(this.size.x, this.size.y, this.size.z);
    const parentOf = (i: number) => this.bones.indexOf(this.bones[i].parent as THREE.Bone);
    const touch = (p: Probe, q: Probe) => {
      if (p.bone < 0 || q.bone < 0) return p.bone === q.bone && Math.hypot(p.rest.x - q.rest.x, p.rest.z - q.rest.z) <= near2;
      const pp = parentOf(p.bone), qp = parentOf(q.bone);
      return p.bone === q.bone || pp === q.bone || qp === p.bone || (pp >= 0 && pp === qp);
    };
    const group = soles.map((_, i) => i);
    const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
    for (let i = 0; i < soles.length; i++) for (let j = i + 1; j < soles.length; j++) if (touch(soles[i], soles[j])) group[find(j)] = find(i);
    const feet = new Map<number, Foot>();
    soles.forEach((p, i) => {
      const g = find(i);
      let foot = feet.get(g);
      if (!foot) feet.set(g, (foot = { probes: [], bone: -1, at: [], need: [] }));
      foot.probes.push(p);
    });
    this.feet.push(...feet.values());
    for (const f of this.feet) {
      // At most 8 points, spread over the sole; the leg turns about the bone nearest the root among those that carry them.
      const stride = Math.max(1, Math.ceil(f.probes.length / 8));
      f.probes = f.probes.filter((_, i) => i % stride === 0);
      const depth = (i: number) => { let d = 0; for (let b: THREE.Object3D | null = this.bones[i]; b && (b as THREE.Bone).isBone; b = b.parent) d++; return d; };
      f.bone = f.probes.reduce((best, p) => (p.bone >= 0 && (best < 0 || depth(p.bone) < depth(best)) ? p.bone : best), -1);
    }
    return true;
  }

  /** Bones to the nearest tip below them that could be a foot (Infinity: none). */
  private leafDistance(bones: THREE.Bone[]): number[] {
    const d = bones.map(() => Infinity);
    const children = bones.map((b) => b.children.filter((c): c is THREE.Bone => (c as THREE.Bone).isBone));
    const of = (i: number): number => {
      if (d[i] !== Infinity) return d[i];
      const kids = children[i].map((c) => bones.indexOf(c)).filter((k) => k >= 0);
      if (!kids.length) return (d[i] = notFoot(bones[i].name) ? Infinity : 0);
      d[i] = Infinity;
      return (d[i] = Math.min(...kids.map((k) => of(k) + 1)));
    };
    bones.forEach((_, i) => of(i));
    return d;
  }

  /**
   * Call after the animation step (and the deform's scales): leans, lifts and reaches the body so the feet meet `ground`.
   * `dt`: seconds since the last pass (for easing).
   */
  apply(dt: number, ground: GroundHeight): void {
    if (!this.active) return;
    const m = this.model;
    const o = this.options;
    m.position.copy(this.basePos);
    m.quaternion.copy(this.baseQuat);
    this.update();
    const height = this.size.y * m.matrixWorld.getMaxScaleOnAxis();

    let seen = this.read(ground);
    // 1. Lean to the plane through the planted feet.
    let weight = 0, cx = 0, cz = 0, cn = 0;
    for (const s of seen) {
      weight += s.planted;
      cx += s.planted * s.x;
      cz += s.planted * s.z;
      cn += s.planted * s.need;
    }
    let target = this.lean;
    const gradient = new THREE.Vector2();
    if (weight >= 0.5) {
      cx /= weight;
      cz /= weight;
      cn /= weight;
      let sxx = 0, sxz = 0, szz = 0, sxn = 0, szn = 0;
      for (const s of seen) {
        const dx = s.x - cx, dz = s.z - cz, dn = s.need - cn;
        sxx += s.planted * dx * dx;
        sxz += s.planted * dx * dz;
        szz += s.planted * dz * dz;
        sxn += s.planted * dx * dn;
        szn += s.planted * dz * dn;
      }
      // A little ridge, so two feet in a line lean across them and not along them.
      const ridge = 0.001 * weight * Math.max(this.size.x, this.size.z) ** 2 * m.matrixWorld.getMaxScaleOnAxis() ** 2;
      const a = sxx + ridge, b = sxz, c = szz + ridge, det = a * c - b * b;
      if (det > 1e-12) gradient.set((c * sxn - b * szn) / det, (a * szn - b * sxn) / det);
      // The body leans so that the soles' needs fall to the plane: raising a point d away by d times the gradient.
      const angle = Math.atan(gradient.length());
      if (angle > o.maxTilt) gradient.multiplyScalar(Math.tan(o.maxTilt) / Math.tan(angle));
      target = gradient;
    } else {
      cx = cz = 0;
    }
    // Eased, so a step in the ground does not snap the body (but never behind by more than a stride).
    const ease = this.lean.lengthSq() === 0 && !Number.isFinite(this.lift) ? 1 : 1 - Math.exp(-dt / 0.12);
    this.lean.lerp(target, Math.min(1, Math.max(0, ease)));
    if (this.lean.lengthSq() > 1e-12 && weight >= 0.5) {
      const normal = new THREE.Vector3(-this.lean.x, 1, -this.lean.y).normalize();
      this.turnAbout(new THREE.Vector3(cx, 0, cz), new THREE.Quaternion().setFromUnitVectors(up, normal), 0, true);
      this.update();
      seen = this.read(ground);
    } else if (weight < 0.5 && this.lean.lengthSq() > 1e-12) {
      // In the air: the lean fades.
      this.lean.multiplyScalar(1 - ease);
    }
    // 2. Lift so no sole is in the ground; lower (slowly) so the planted ones touch it.
    let top = -Infinity;
    for (const s of seen) top = Math.max(top, s.need);
    // Farther above the ground than a quarter of the body's height it is a jump or a fall, not a step: the body is left where it is.
    let wanted = top >= -0.25 * height ? top : 0;
    if (weight < 0.5) wanted = Math.max(0, top);
    if (!Number.isFinite(this.lift)) this.lift = wanted;
    else if (wanted >= this.lift) this.lift = wanted;
    else this.lift = Math.max(wanted, this.lift - 4 * height * dt);
    this.turnAbout(new THREE.Vector3(), new THREE.Quaternion(), this.lift, false);
    this.update();
    // 3. Each leg reaches what is left: its points are drawn down to the ground by the planted share, and up out of it all the way.
    // A few rounds, since turning a foot to bring one edge of its sole down can sink another.
    for (let round = 0; ; round++) {
      seen = this.read(ground);
      if (round === 3) break;
      let again = false;
      for (let f = 0; f < this.feet.length; f++) {
        const s = seen[f];
        // A foot far above the ground is in a jump or a fall: it does not reach for it.
        if (s.need < -o.reach * height) continue;
        const down = round === 0 ? s.planted : 0;
        if (s.need <= 1e-3 * height && !(down > 0 && s.need < -1e-3 * height)) continue;
        this.reach(this.feet[f], down, o.reach * height);
        again = true;
      }
      if (!again) break;
      m.updateMatrixWorld(true);
    }
    this.readings.length = 0;
    for (const s of seen) this.readings.push({ x: s.x, y: s.y, z: s.z, ground: s.ground, planted: s.planted });
  }

  /** Brings the model's matrices up to date (its parents' too: the host moves the animal before this). */
  private update(): void {
    this.model.parent?.updateWorldMatrix(true, false);
    this.model.updateMatrixWorld(true);
  }

  /** One reading for each foot: where its worst sole point is, how far it must rise to stand on the ground, and whether it is planted. Fills each foot's points. */
  private read(ground: GroundHeight): FootReadingNeed[] {
    const out: FootReadingNeed[] = [];
    const v = new THREE.Vector3(), r = new THREE.Vector3();
    const m = this.model;
    const scale = m.matrixWorld.getMaxScaleOnAxis();
    const tall = this.size.y * scale;
    for (const foot of this.feet) {
      let best = -Infinity, bx = 0, by = 0, bz = 0, lifted = Infinity;
      foot.probes.forEach((p, k) => {
        p.mesh.getVertexPosition(p.index, v).applyMatrix4(p.mesh.matrixWorld);
        r.copy(p.rest).applyMatrix4(m.matrixWorld);
        // How far the animation has raised this point above its rest place.
        lifted = Math.min(lifted, v.y - r.y);
        const need = ground(v.x, v.z) + p.height * scale - v.y;
        (foot.at[k] ??= new THREE.Vector3()).copy(v);
        foot.need[k] = need;
        if (need > best) (best = need), (bx = v.x), (by = v.y), (bz = v.z);
      });
      out.push({ x: bx, y: by, z: bz, need: best, planted: 1 - smooth(0.01 * tall, 0.06 * tall, lifted), ground: ground(bx, bz) });
    }
    return out;
  }

  /** Turns the model about a world point and lifts it, as one move of its matrix. */
  private turnAbout(pivot: THREE.Vector3, turn: THREE.Quaternion, lift: number, keepHeight: boolean): void {
    const m = this.model;
    const world = m.matrixWorld.clone();
    const move = new THREE.Matrix4();
    if (keepHeight) {
      // About the point at the model's height: the plane through the feet turns, the body stays over it.
      const at = new THREE.Vector3().setFromMatrixPosition(world);
      pivot = new THREE.Vector3(pivot.x, at.y, pivot.z);
      move.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(turn)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    } else move.makeTranslation(0, lift, 0);
    world.premultiply(move);
    const parent = m.parent ? m.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
    const local = parent.multiply(world);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    local.decompose(p, q, s);
    m.position.copy(p);
    m.quaternion.copy(q);
  }

  /**
   * Moves a foot's points toward the ground with the leg's bones: each point that is in the ground goes up to it, and those above it come
   * down by the share `down`, at most `limit` meters. CCD over the chain, all the foot's points at once (so the sole turns to the ground
   * and does not just bob), each bone within its bend limit.
   */
  private reach(foot: Foot, down: number, limit: number): void {
    if (foot.bone < 0) return;
    const chain: THREE.Bone[] = [];
    for (let b: THREE.Object3D | null = this.bones[foot.bone]; b && (b as THREE.Bone).isBone && chain.length < this.options.chain; b = b.parent) chain.push(b as THREE.Bone);
    const n = foot.probes.length;
    // The points ride on the foot bone: where they are in its frame, and where they should go (world).
    const toBone = new THREE.Matrix4().copy(chain[0].matrixWorld).invert();
    const offsets = foot.at.map((p) => p.clone().applyMatrix4(toBone));
    const goals = foot.at.map((p, k) => {
      const need = foot.need[k];
      const move = need > 0 ? need : need * down;
      return p.clone().setY(p.y + Math.max(-limit, Math.min(limit, move)));
    });
    const here = foot.at.map((p) => p.clone());
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cross = new THREE.Vector3(), axis = new THREE.Vector3(), t = new THREE.Vector3();
    const dq = new THREE.Quaternion();
    const identity = new THREE.Matrix4();
    const tolerance = 1e-3 * this.size.y;
    for (let pass = 0; pass < 8; pass++) {
      for (let j = 0; j < chain.length; j++) {
        const bone = chain[j];
        let off = 0;
        for (let k = 0; k < n; k++) {
          here[k].copy(offsets[k]).applyMatrix4(chain[0].matrixWorld);
          off = Math.max(off, here[k].distanceTo(goals[k]));
        }
        if (off < tolerance) return;
        // The turn is found in the bone's parent's own frame (its scales make the world's frame skewed: a deformed giant), about the bone.
        const inverse = (bone.parent ? bone.parent.matrixWorld : identity).clone().invert();
        cross.set(0, 0, 0);
        let dot = 0;
        for (let k = 0; k < n; k++) {
          a.copy(here[k]).applyMatrix4(inverse).sub(bone.position);
          b.copy(goals[k]).applyMatrix4(inverse).sub(bone.position);
          cross.add(t.crossVectors(a, b));
          dot += a.dot(b);
        }
        const sin = cross.length();
        if (sin < 1e-12) continue;
        // Most of the turn that would fit best, for each bone and pass.
        dq.setFromAxisAngle(axis.copy(cross).divideScalar(sin), 0.7 * Math.atan2(sin, dot));
        const q = bone.quaternion.clone().premultiply(dq);
        if (!this.turned.has(bone)) this.turned.set(bone, bone.quaternion.clone());
        const from = this.turned.get(bone)!;
        const angle = from.angleTo(q);
        if (angle > this.options.bend) q.copy(from).slerp(q, this.options.bend / angle);
        bone.quaternion.copy(q);
        for (let k = j; k >= 0; k--) chain[k].updateMatrixWorld(false);
      }
    }
  }
}

interface FootReadingNeed extends FootReading {
  /** How far the sole must rise to stand on the ground (negative: it floats). */
  need: number;
}
