import * as THREE from "three";
import type { ThreeActor, PlayableClip } from "./index";

export interface MountOptions {
  /** Bone of the mount whose head is the lowest point of the saddle's seat (default "saddle"; see `manifest.extra.animal.seat`). */
  seatBone?: string;
  /** Pose the rider takes (e.g. `RIDE` from @actors/human); played on the rider when given. */
  pose?: PlayableClip;
  /**
   * Where the rider's seat is, from the middle of its hip joints, in metres for a
   * 1.75 m rider (scaled with the rider's height): down to the seat bones, a little back.
   */
  seat?: [number, number, number];
  /** Rider's hip joints (default the human rig's "thigh_l" and "thigh_r"). */
  hips?: [string, string];
}

/**
 * Seats a rider on a mount (a human actor on a horse): every `update` the
 * rider's object is placed so its seat is on the saddle and it moves with the
 * saddle bone, through every gait and shape change of either actor.
 *
 * ```ts
 * const mount = new Mount(horse, character.actor, { pose: RIDE });
 * // every frame, after both actors' update(dt):
 * mount.update();
 * ```
 */
export class Mount {
  private readonly seatBone: string;
  private readonly offset: THREE.Vector3;
  private readonly hips: [string, string];
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Matrix4();

  constructor(
    readonly mount: ThreeActor,
    readonly rider: ThreeActor,
    options: MountOptions = {},
  ) {
    this.seatBone = options.seatBone ?? "saddle";
    this.offset = new THREE.Vector3(...(options.seat ?? [0, -0.085, -0.035]));
    this.hips = options.hips ?? ["thigh_l", "thigh_r"];
    if (options.pose) rider.play(options.pose);
  }

  /** The mount's seat bone (null before its first shape). */
  private seat(): { bone: THREE.Bone; inverse: THREE.Matrix4; head: THREE.Vector3 } | null {
    const fitted = this.mount.fittedSkeleton;
    const i = fitted?.names.indexOf(this.seatBone) ?? -1;
    if (!fitted || i < 0 || !this.mount.skeleton) return null;
    return { bone: this.mount.bones[i], inverse: this.mount.skeleton.boneInverses[i], head: new THREE.Vector3(...fitted.heads[i]) };
  }

  /** The rider's seat in its own object space: below the middle of its hip joints. */
  riderSeat(): THREE.Vector3 | null {
    const fitted = this.rider.fittedSkeleton;
    if (!fitted) return null;
    const [a, b] = this.hips.map((n) => fitted.names.indexOf(n));
    if (a < 0 || b < 0) return null;
    const mid = new THREE.Vector3(...fitted.heads[a]).add(new THREE.Vector3(...fitted.heads[b])).multiplyScalar(0.5);
    // Scale the offset with the rider: hip height of a 1.75 m adult is about 0.92 m.
    const k = Math.max(0.3, mid.y / 0.92);
    return mid.add(this.offset.clone().multiplyScalar(k));
  }

  /** Places the rider. Call every frame after updating both actors. */
  update(): void {
    const seat = this.seat();
    const riderSeat = this.riderSeat();
    if (!seat || !riderSeat) return;
    this.mount.object.updateMatrixWorld(true);
    // The seat bone's motion since the bind pose, applied to the bind-pose seat point (like a skinned vertex),
    // then the rider moved so its own seat lands there.
    this.m.multiplyMatrices(seat.bone.matrixWorld, seat.inverse);
    this.m.multiply(this.t.makeTranslation(seat.head.x - riderSeat.x, seat.head.y - riderSeat.y, seat.head.z - riderSeat.z));
    const obj = this.rider.object;
    if (obj.parent) {
      obj.parent.updateMatrixWorld(true);
      this.m.premultiply(this.t.copy(obj.parent.matrixWorld).invert());
    }
    this.m.decompose(obj.position, obj.quaternion, obj.scale);
    obj.updateMatrixWorld(true);
  }
}
