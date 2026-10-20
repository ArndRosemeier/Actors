import { type Quat, type Vec3, quatAxisAngle, quatConjugate, quatMul } from "@actors/core";

export interface BvhJoint {
  name: string;
  parent: number;
  offset: Vec3;
  channels: string[];
  channelStart: number;
  endSite?: Vec3;
}

export interface Bvh {
  joints: BvhJoint[];
  frameTime: number;
  frameCount: number;
  /** All channel values, frame after frame. */
  values: Float32Array;
  channelCount: number;
}

export function parseBvh(text: string): Bvh {
  const tokens = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints: BvhJoint[] = [];
  let channelCount = 0;
  const stack: number[] = [];
  while (tokens[i] !== "MOTION") {
    if (i >= tokens.length) throw new Error("BVH has no MOTION section");
    const t = tokens[i++];
    if (t === "ROOT" || t === "JOINT") {
      joints.push({ name: tokens[i++], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [], channelStart: 0 });
    } else if (t === "{") {
      stack.push(joints.length - 1);
    } else if (t === "}") {
      stack.pop();
    } else if (t === "OFFSET") {
      joints[joints.length - 1].offset = [+tokens[i++], +tokens[i++], +tokens[i++]];
    } else if (t === "CHANNELS") {
      const n = +tokens[i++];
      const j = joints[joints.length - 1];
      j.channelStart = channelCount;
      j.channels = tokens.slice(i, i + n);
      i += n;
      channelCount += n;
    } else if (t === "End") {
      // "End Site { OFFSET x y z }": the stack top is the joint that owns it.
      i += 3; // Site { OFFSET
      joints[stack[stack.length - 1]].endSite = [+tokens[i++], +tokens[i++], +tokens[i++]];
      i++; // }
    }
  }
  i += 2; // MOTION Frames:
  const frameCount = +tokens[i++];
  i += 2; // Frame Time:
  const frameTime = +tokens[i++];
  const available = Math.floor((tokens.length - i) / channelCount);
  const n = Math.min(frameCount, available);
  const values = new Float32Array(n * channelCount);
  for (let k = 0; k < values.length; k++) values[k] = +tokens[i + k];
  return { joints, frameTime, frameCount: n, values, channelCount };
}

const AXES: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

export function rotate(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), quatConjugate(q));
  return [p[0], p[1], p[2]];
}

/**
 * World rotations and positions of every joint for one frame; frame -1 is the
 * rest pose (all rotations zero), which is how the skeleton's offsets are defined.
 */
export function poseFrame(bvh: Bvh, frame: number): { rot: Quat[]; pos: Vec3[] } {
  const rot: Quat[] = [];
  const pos: Vec3[] = [];
  const base = frame * bvh.channelCount;
  for (const j of bvh.joints) {
    let local: Quat = [0, 0, 0, 1];
    const translation: Vec3 = [0, 0, 0];
    if (frame >= 0)
      j.channels.forEach((ch, k) => {
        const value = bvh.values[base + j.channelStart + k];
        if (ch.endsWith("rotation")) local = quatMul(local, quatAxisAngle(AXES[ch[0]], (value * Math.PI) / 180));
        else translation["XYZ".indexOf(ch[0])] = value;
      });
    if (j.parent < 0) {
      rot.push(local);
      pos.push([j.offset[0] + translation[0], j.offset[1] + translation[1], j.offset[2] + translation[2]]);
    } else {
      const pr = rot[j.parent];
      const o = rotate(pr, j.offset);
      const pp = pos[j.parent];
      rot.push(quatMul(pr, local));
      pos.push([pp[0] + o[0], pp[1] + o[1], pp[2] + o[2]]);
    }
  }
  return { rot, pos };
}
