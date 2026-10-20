/**
 * One level of Catmull-Clark subdivision, precomputed as a sparse linear
 * "stencil": every new vertex is a fixed weighted sum of original vertices.
 * At runtime, subdivided positions = stencil x morphed base positions, so
 * subdivision stays cheap and follows every morph exactly.
 */
export interface SubdivFace {
  v: number[]; // original vertex indices
  uv: [number, number][]; // per-corner UVs
}

export interface Subdivided {
  /** CSR stencil: row r = new vertex r. */
  rowPtr: number[];
  cols: number[];
  weights: number[];
  vertexCount: number;
  quads: { v: number[]; uv: [number, number][] }[];
}

type Combo = Map<number, number>;

function add(target: Combo, src: Combo | number, w: number) {
  if (typeof src === "number") {
    target.set(src, (target.get(src) ?? 0) + w);
    return;
  }
  for (const [k, v] of src) target.set(k, (target.get(k) ?? 0) + v * w);
}

export function catmullClark(faces: SubdivFace[]): Subdivided {
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edgeFaces = new Map<string, number[]>();
  const vertFaces = new Map<number, number[]>();
  const vertEdges = new Map<number, Set<string>>();
  faces.forEach((f, fi) => {
    f.v.forEach((v, i) => {
      const w = f.v[(i + 1) % f.v.length];
      const k = edgeKey(v, w);
      if (!edgeFaces.has(k)) edgeFaces.set(k, []);
      edgeFaces.get(k)!.push(fi);
      if (!vertFaces.has(v)) vertFaces.set(v, []);
      vertFaces.get(v)!.push(fi);
      for (const x of [v, w]) {
        if (!vertEdges.has(x)) vertEdges.set(x, new Set());
        vertEdges.get(x)!.add(k);
      }
    });
  });

  const facePoint: Combo[] = faces.map((f) => {
    const c: Combo = new Map();
    for (const v of f.v) add(c, v, 1 / f.v.length);
    return c;
  });

  const edgePoint = new Map<string, Combo>();
  const boundaryVerts = new Set<number>();
  for (const [k, fs] of edgeFaces) {
    const [a, b] = k.split("_").map(Number);
    const c: Combo = new Map();
    if (fs.length === 2) {
      add(c, a, 0.25);
      add(c, b, 0.25);
      add(c, facePoint[fs[0]], 0.25);
      add(c, facePoint[fs[1]], 0.25);
    } else {
      add(c, a, 0.5);
      add(c, b, 0.5);
      boundaryVerts.add(a);
      boundaryVerts.add(b);
    }
    edgePoint.set(k, c);
  }

  const vertexPoint = new Map<number, Combo>();
  for (const [v, edges] of vertEdges) {
    const c: Combo = new Map();
    if (boundaryVerts.has(v)) {
      // Boundary rule: (prev + 6v + next) / 8 along the boundary edges.
      const bEdges = [...edges].filter((k) => edgeFaces.get(k)!.length === 1);
      add(c, v, 6 / 8);
      for (const k of bEdges.slice(0, 2)) {
        const [a, b] = k.split("_").map(Number);
        add(c, a === v ? b : a, 1 / 8);
      }
    } else {
      const n = edges.size;
      const fs = vertFaces.get(v)!;
      for (const fi of fs) add(c, facePoint[fi], 1 / (fs.length * n));
      for (const k of edges) {
        const [a, b] = k.split("_").map(Number);
        add(c, a, 2 / (n * n) / 2);
        add(c, b, 2 / (n * n) / 2);
      }
      add(c, v, (n - 3) / n);
    }
    vertexPoint.set(v, c);
  }

  // Number the new vertices and emit the stencil.
  const rows: Combo[] = [];
  const vIndex = new Map<number, number>();
  const eIndex = new Map<string, number>();
  const fIndex: number[] = [];
  for (const [v, c] of vertexPoint) {
    vIndex.set(v, rows.length);
    rows.push(c);
  }
  for (const [k, c] of edgePoint) {
    eIndex.set(k, rows.length);
    rows.push(c);
  }
  facePoint.forEach((c) => {
    fIndex.push(rows.length);
    rows.push(c);
  });

  const rowPtr = [0];
  const cols: number[] = [];
  const weights: number[] = [];
  for (const c of rows) {
    for (const [k, w] of c) {
      if (Math.abs(w) < 1e-7) continue;
      cols.push(k);
      weights.push(w);
    }
    rowPtr.push(cols.length);
  }

  const quads: Subdivided["quads"] = [];
  faces.forEach((f, fi) => {
    const n = f.v.length;
    const fuv: [number, number] = [0, 0];
    f.uv.forEach(([u, v]) => ((fuv[0] += u / n), (fuv[1] += v / n)));
    const mid = (i: number): [number, number] => {
      const a = f.uv[i], b = f.uv[(i + 1) % n];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    };
    for (let i = 0; i < n; i++) {
      const prev = (i + n - 1) % n;
      quads.push({
        v: [vIndex.get(f.v[i])!, eIndex.get(edgeKey(f.v[i], f.v[(i + 1) % n]))!, fIndex[fi], eIndex.get(edgeKey(f.v[prev], f.v[i]))!],
        uv: [f.uv[i], mid(i), fuv, mid(prev)],
      });
    }
  });

  return { rowPtr, cols, weights, vertexCount: rows.length, quads };
}

/** A render mesh whose triangles come in quad pairs: (a, b, c), (a, c, d). */
export interface QuadPairMesh {
  map: ArrayLike<number>;
  uv: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface SubdividedMesh {
  map: Uint32Array;
  uv: Float32Array;
  indices: Uint32Array;
  stencil: { rows: number; rowPtr: Uint32Array; cols: Uint32Array; weights: Float32Array };
}

/**
 * One Catmull-Clark level of a quad render mesh. Done at load time instead of
 * shipping the result, which keeps actor packs small.
 */
export function subdivideQuadMesh(src: QuadPairMesh): SubdividedMesh {
  const faces: SubdivFace[] = [];
  const { map, uv, indices } = src;
  for (let t = 0; t + 5 < indices.length; t += 6) {
    const [a, b, c, a2, c2, d] = [0, 1, 2, 3, 4, 5].map((k) => indices[t + k]);
    if (a !== a2 || c !== c2) throw new Error("subdivideQuadMesh: triangles are not quad pairs");
    const corners = [a, b, c, d];
    faces.push({ v: corners.map((i) => map[i]), uv: corners.map((i) => [uv[i * 2], uv[i * 2 + 1]] as [number, number]) });
  }
  const sub = catmullClark(faces);
  const key = new Map<string, number>();
  const outMap: number[] = [];
  const outUv: number[] = [];
  const outIdx: number[] = [];
  for (const q of sub.quads) {
    const ids = q.v.map((v, i) => {
      const k = `${v}/${q.uv[i][0].toFixed(5)}/${q.uv[i][1].toFixed(5)}`;
      let id = key.get(k);
      if (id === undefined) {
        id = outMap.length;
        key.set(k, id);
        outMap.push(v);
        outUv.push(q.uv[i][0], q.uv[i][1]);
      }
      return id;
    });
    outIdx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  return {
    map: Uint32Array.from(outMap),
    uv: Float32Array.from(outUv),
    indices: Uint32Array.from(outIdx),
    stencil: { rows: sub.vertexCount, rowPtr: Uint32Array.from(sub.rowPtr), cols: Uint32Array.from(sub.cols), weights: Float32Array.from(sub.weights) },
  };
}
