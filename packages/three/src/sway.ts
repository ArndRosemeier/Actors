import * as THREE from "three";

/**
 * Cloth motion for loose garments (skirts, dresses, robes, tunics), cheap enough for every
 * character: no cloth simulation, just one point that follows the hips on a damped spring, in world
 * space. How far it trails the hips becomes the tilt of the cloth below them (the shader swings
 * each vertex by that tilt times how far below the hips it hangs), and a second spring makes the
 * cloth lag the hips' turn. Moving at a steady speed leaves a little drag; starting, stopping and
 * turning make the hem swing and settle.
 */
export class ClothSway {
  /** How fast the cloth swings back (rad/s; about 0.7 Hz) and how much each swing dies away. */
  static readonly FREQ = 4.4;
  static readonly DAMP = 0.5;
  /** Air drag on the cloth: the steady lean at a steady speed is DRAG * speed / FREQ^2 metres. */
  static readonly DRAG = 0.45;
  /** The length that turns the trail into a tilt (about where a long skirt's mass hangs). */
  static readonly LENGTH = 0.9;
  static readonly MAX_TILT = 0.2;
  static readonly MAX_TWIST = 0.4;

  /** The cloth point and its velocity (world, horizontal). */
  private readonly p = new THREE.Vector2();
  private readonly v = new THREE.Vector2();
  /** The hips last frame (world, horizontal) and their yaw. */
  private readonly last = new THREE.Vector2();
  private yaw = 0;
  private lastYaw = 0;
  private yawVel = 0;
  private started = false;

  /** The tilt (x, z, radians, world) and the turn lag (radians) after the last step. */
  readonly tilt = new THREE.Vector2();
  twist = 0;

  /** Starts over at rest (after a teleport, or when the cloth reappears). */
  reset(): void {
    this.started = false;
    this.tilt.set(0, 0);
    this.twist = 0;
  }

  /**
   * One frame: `hips` is where the cloth hangs from (world), `hipYaw` the hips' heading around +Y.
   */
  step(hips: THREE.Vector3, hipYaw: number, dt: number): void {
    if (!this.started || dt <= 0) {
      this.started = true;
      this.p.set(hips.x, hips.z);
      this.v.set(0, 0);
      this.last.set(hips.x, hips.z);
      this.yaw = this.lastYaw = hipYaw;
      this.yawVel = 0;
      return;
    }
    const target = new THREE.Vector2(hips.x, hips.z);
    // A jump of more than a metre in a frame is a teleport, not motion.
    if (target.distanceTo(this.last) > 1) return this.reset();
    dt = Math.min(dt, 0.1);
    const from = this.last.clone();
    const tv = target.clone().sub(from).divideScalar(dt);
    let turn = hipYaw - this.lastYaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const turnVel = turn / dt;
    this.last.copy(target);
    this.lastYaw = hipYaw;
    const w = ClothSway.FREQ, z = ClothSway.DAMP;
    // Substeps keep the spring stable at low frame rates.
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    let yawTarget = this.yaw + (hipYaw - this.yaw - Math.round((hipYaw - this.yaw) / (2 * Math.PI)) * 2 * Math.PI);
    for (let i = 0; i < n; i++) {
      // The hips move through the frame, not all at its start.
      const k = ((i + 1) * h) / dt, tx = from.x + (target.x - from.x) * k, tz = from.y + (target.y - from.y) * k;
      // Toward the hips (spring), damped against the hips' own motion, plus drag against the air.
      const ax = w * w * (tx - this.p.x) - 2 * z * w * (this.v.x - tv.x) - ClothSway.DRAG * this.v.x;
      const az = w * w * (tz - this.p.y) - 2 * z * w * (this.v.y - tv.y) - ClothSway.DRAG * this.v.y;
      this.v.x += ax * h;
      this.v.y += az * h;
      this.p.x += this.v.x * h;
      this.p.y += this.v.y * h;
      const wt = w * 1.2;
      this.yawVel += (wt * wt * (yawTarget - this.yaw) - 2 * z * wt * (this.yawVel - turnVel)) * h;
      this.yaw += this.yawVel * h;
    }
    yawTarget = hipYaw;
    let lag = this.yaw - yawTarget;
    lag = Math.atan2(Math.sin(lag), Math.cos(lag));
    if (Math.abs(lag) > ClothSway.MAX_TWIST) {
      lag = Math.sign(lag) * ClothSway.MAX_TWIST;
      this.yaw = yawTarget + lag;
    }
    this.twist = lag;
    this.tilt.set(this.p.x - target.x, this.p.y - target.y).divideScalar(ClothSway.LENGTH);
    const t = this.tilt.length();
    if (t > ClothSway.MAX_TILT) {
      this.tilt.multiplyScalar(ClothSway.MAX_TILT / t);
      // Keep the point on the limit, so it swings back from there.
      this.p.set(target.x + this.tilt.x * ClothSway.LENGTH, target.y + this.tilt.y * ClothSway.LENGTH);
    }
  }
}
