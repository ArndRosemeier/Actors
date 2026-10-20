export interface ObjFace {
  group: string;
  v: number[];
  vt: number[];
}

export interface ObjData {
  positions: number[]; // flat xyz
  uvs: number[]; // flat uv
  faces: ObjFace[];
}

export function parseObj(text: string): ObjData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const faces: ObjFace[] = [];
  let group = "default";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      positions.push(+x, +y, +z);
    } else if (line.startsWith("vt ")) {
      const [, u, v] = line.split(/\s+/);
      uvs.push(+u, +v);
    } else if (line.startsWith("g ")) {
      group = line.split(/\s+/)[1] ?? "default";
    } else if (line.startsWith("f ")) {
      const v: number[] = [];
      const vt: number[] = [];
      for (const corner of line.split(/\s+/).slice(1)) {
        const [a, b] = corner.split("/");
        v.push(+a - 1);
        vt.push(b ? +b - 1 : -1);
      }
      faces.push({ group, v, vt });
    }
  }
  return { positions, uvs, faces };
}

/** Splits vertices at UV seams and triangulates. */
export function buildRenderMesh(obj: ObjData, faces: ObjFace[]) {
  const key = new Map<string, number>();
  const map: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const corner = (v: number, vt: number) => {
    const k = `${v}/${vt}`;
    let i = key.get(k);
    if (i === undefined) {
      i = map.length;
      key.set(k, i);
      map.push(v);
      uv.push(vt >= 0 ? obj.uvs[vt * 2] : 0, vt >= 0 ? obj.uvs[vt * 2 + 1] : 0);
    }
    return i;
  };
  for (const f of faces) {
    const ids = f.v.map((v, i) => corner(v, f.vt[i]));
    for (let i = 1; i + 1 < ids.length; i++) indices.push(ids[0], ids[i], ids[i + 1]);
  }
  return { map, uv, indices };
}
