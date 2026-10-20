/** Parser for MakeHuman .mhclo proxy files (clothes and body-part proxies). */
export interface Mhclo {
  name: string;
  objFile: string;
  refs: number[];
  weights: number[];
  offsets: number[];
  /** [a, b, restLength] for x, y, z (in that order). */
  scale: [number, number, number][];
  deleteVerts: number[];
  material?: string;
}

export function parseMhclo(text: string): Mhclo {
  const out: Mhclo = { name: "", objFile: "", refs: [], weights: [], offsets: [], scale: [], deleteVerts: [] };
  let section: "header" | "verts" | "delete" = "header";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "verts") {
      section = "verts";
      continue;
    }
    if (parts[0] === "delete_verts") {
      section = "delete";
      continue;
    }
    if (section === "verts" && /^-?\d/.test(parts[0])) {
      if (parts.length >= 9) {
        out.refs.push(+parts[0], +parts[1], +parts[2]);
        out.weights.push(+parts[3], +parts[4], +parts[5]);
        out.offsets.push(+parts[6], +parts[7], +parts[8]);
      } else {
        out.refs.push(+parts[0], +parts[0], +parts[0]);
        out.weights.push(1, 0, 0);
        out.offsets.push(0, 0, 0);
      }
      continue;
    }
    if (section === "delete") {
      // Indices and "a - b" ranges.
      for (let i = 0; i < parts.length; i++) {
        if (parts[i + 1] === "-") {
          for (let v = +parts[i]; v <= +parts[i + 2]; v++) out.deleteVerts.push(v);
          i += 2;
        } else if (/^\d+$/.test(parts[i])) out.deleteVerts.push(+parts[i]);
      }
      continue;
    }
    // Header keys can also appear after "verts" (e.g. "material"); they don't end the vertex block.
    if (parts[0] === "name") out.name = parts[1];
    else if (parts[0] === "obj_file") out.objFile = parts[1];
    else if (parts[0] === "material") out.material = parts[1];
    else if (/^[xyz]_scale$/.test(parts[0])) out.scale["xyz".indexOf(parts[0][0])] = [+parts[1], +parts[2], +parts[3]];
    // Newer MakeClothes "shear" references: two vertices and their rest coordinates on that axis.
    else if (/^shear_[xyz]$/.test(parts[0])) out.scale["xyz".indexOf(parts[0][6])] ??= [+parts[1], +parts[2], Math.abs(+parts[4] - +parts[3])];
  }
  return out;
}
