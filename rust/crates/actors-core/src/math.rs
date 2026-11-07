//! Minimal column-major 3x3 and quaternion helpers in f64, so the core has no renderer
//! dependency. Mirrors `packages/core/src/math.ts`.

pub type Vec3 = [f64; 3];
/// Column-major 3x3: m[col*3 + row].
pub type Mat3 = [f64; 9];
/// Quaternion [x, y, z, w].
pub type Quat = [f64; 4];

pub const MAT3_IDENTITY: Mat3 = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
pub const QUAT_IDENTITY: Quat = [0.0, 0.0, 0.0, 1.0];

/// Like JavaScript's `Math.hypot` for 3 values.
#[inline]
pub fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    (x * x + y * y + z * z).sqrt()
}

#[inline]
pub fn hypot4(x: f64, y: f64, z: f64, w: f64) -> f64 {
    (x * x + y * y + z * z + w * w).sqrt()
}

#[inline]
pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
pub fn scale(a: Vec3, k: f64) -> Vec3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

#[inline]
pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

#[inline]
pub fn length(a: Vec3) -> f64 {
    hypot3(a[0], a[1], a[2])
}

/// Unit vector (the zero vector stays zero).
#[inline]
pub fn normalize(a: Vec3) -> Vec3 {
    let l = length(a);
    let l = if l == 0.0 { 1.0 } else { l };
    [a[0] / l, a[1] / l, a[2] / l]
}

pub fn mat3_mul(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut out = [0.0; 9];
    for c in 0..3 {
        for r in 0..3 {
            out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
        }
    }
    out
}

pub fn mat3_transpose(a: &Mat3) -> Mat3 {
    [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
}

/// Rotation of `angle` radians around unit `axis`.
pub fn mat3_axis_angle(axis: Vec3, angle: f64) -> Mat3 {
    let [x, y, z] = axis;
    let c = angle.cos();
    let s = angle.sin();
    let t = 1.0 - c;
    [
        t * x * x + c,
        t * x * y + s * z,
        t * x * z - s * y,
        t * x * y - s * z,
        t * y * y + c,
        t * y * z + s * x,
        t * x * z + s * y,
        t * y * z - s * x,
        t * z * z + c,
    ]
}

/// Applies a rotation matrix to a vector.
pub fn mat3_apply(m: &Mat3, v: Vec3) -> Vec3 {
    [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]
}

pub fn quat_from_mat3(m: &Mat3) -> Quat {
    let (m00, m10, m20) = (m[0], m[1], m[2]);
    let (m01, m11, m21) = (m[3], m[4], m[5]);
    let (m02, m12, m22) = (m[6], m[7], m[8]);
    let trace = m00 + m11 + m22;
    if trace > 0.0 {
        let s = 0.5 / (trace + 1.0).sqrt();
        [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
    } else if m00 > m11 && m00 > m22 {
        let s = 2.0 * (1.0 + m00 - m11 - m22).sqrt();
        [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
    } else if m11 > m22 {
        let s = 2.0 * (1.0 + m11 - m00 - m22).sqrt();
        [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
    } else {
        let s = 2.0 * (1.0 + m22 - m00 - m11).sqrt();
        [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
    }
}

/// Rotation matrix of a unit quaternion.
pub fn mat3_from_quat(q: Quat) -> Mat3 {
    let [x, y, z, w] = q;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [1.0 - (yy + zz), xy + wz, xz - wy, xy - wz, 1.0 - (xx + zz), yz + wx, xz + wy, yz - wx, 1.0 - (xx + yy)]
}

pub fn quat_mul(a: Quat, b: Quat) -> Quat {
    let [ax, ay, az, aw] = a;
    let [bx, by, bz, bw] = b;
    [
        ax * bw + aw * bx + ay * bz - az * by,
        ay * bw + aw * by + az * bx - ax * bz,
        az * bw + aw * bz + ax * by - ay * bx,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

pub fn quat_conjugate(q: Quat) -> Quat {
    [-q[0], -q[1], -q[2], q[3]]
}

pub fn quat_axis_angle(axis: Vec3, angle: f64) -> Quat {
    let [x, y, z] = normalize(axis);
    let s = (angle / 2.0).sin();
    [x * s, y * s, z * s, (angle / 2.0).cos()]
}

/// q · v · q⁻¹ for a unit quaternion.
pub fn quat_rotate(q: Quat, v: Vec3) -> Vec3 {
    let [qx, qy, qz, qw] = q;
    let tx = 2.0 * (qy * v[2] - qz * v[1]);
    let ty = 2.0 * (qz * v[0] - qx * v[2]);
    let tz = 2.0 * (qx * v[1] - qy * v[0]);
    [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)]
}

/// Shortest-arc rotation taking unit vector a onto unit vector b.
pub fn quat_from_to(a: Vec3, b: Vec3) -> Quat {
    let d = dot(a, b);
    if d < -0.999999 {
        let axis = if a[0].abs() < 0.9 { normalize([0.0, -a[2], a[1]]) } else { normalize([a[2], 0.0, -a[0]]) };
        return [axis[0], axis[1], axis[2], 0.0];
    }
    let c = cross(a, b);
    let q = [c[0], c[1], c[2], 1.0 + d];
    let l = hypot4(q[0], q[1], q[2], q[3]);
    [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

/// Spherical interpolation on the shorter arc (b flipped to a's hemisphere), normalized.
pub fn quat_slerp(a: Quat, b: Quat, t: f64) -> Quat {
    let [mut bx, mut by, mut bz, mut bw] = b;
    let mut cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if cos < 0.0 {
        cos = -cos;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    let (mut k0, mut k1) = (1.0 - t, t);
    if cos < 0.9995 {
        let th = cos.acos();
        let s = th.sin();
        k0 = ((1.0 - t) * th).sin() / s;
        k1 = (t * th).sin() / s;
    }
    let q = [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
    let l = hypot4(q[0], q[1], q[2], q[3]);
    let l = if l == 0.0 { 1.0 } else { l };
    [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
