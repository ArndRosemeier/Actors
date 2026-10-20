export type Vec3 = [number, number, number];

/**
 * Closest point of a triangle to p (Ericson's region method): its distance
 * and the feature it lies on, as triangle corner indices (one = a corner,
 * two = an edge, three = inside the face).
 */
export function closestOnTriangle(p: Vec3, [a, b, c]: [Vec3, Vec3, Vec3]): { distance: number; feature: number[] } {
  const sub = (u: Vec3, w: Vec3): Vec3 => [u[0] - w[0], u[1] - w[1], u[2] - w[2]];
  const dot = (u: Vec3, w: Vec3) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  /** Distance from p to u + s (w - u) + t (x - u). */
  const at = (u: Vec3, w: Vec3, x: Vec3, s: number, t: number) => {
    const q = [0, 1, 2].map((i) => p[i] - (u[i] + s * (w[i] - u[i]) + t * (x[i] - u[i])));
    return Math.hypot(q[0], q[1], q[2]);
  };
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { distance: Math.hypot(...ap), feature: [0] };
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { distance: Math.hypot(...bp), feature: [1] };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return { distance: at(a, b, c, d1 / (d1 - d3), 0), feature: [0, 1] };
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { distance: Math.hypot(...cp), feature: [2] };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return { distance: at(a, b, c, 0, d2 / (d2 - d6)), feature: [0, 2] };
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return { distance: at(b, c, c, w, 0), feature: [1, 2] };
  }
  const denom = 1 / (va + vb + vc);
  return { distance: at(a, b, c, vb * denom, vc * denom), feature: [0, 1, 2] };
}

export const pointTriangleDistance = (p: Vec3, tri: [Vec3, Vec3, Vec3]) => closestOnTriangle(p, tri).distance;
