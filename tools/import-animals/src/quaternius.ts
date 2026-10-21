/**
 * The deer's rig and clips: Quaternius' "Ultimate Animated Animals" pack
 * (CC0, quaternius.com), the low-poly Deer model. Only its skeleton and
 * animations are used, plus its proportions as the blueprint for the body.
 * The pack is shared from Google Drive; files are fetched by id.
 */
import { readFileSync } from "node:fs";
import { fetchCached } from "../../import-makehuman/src/fetch";

const drive = (id: string) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

/** glTF (embedded buffer) of the low-poly doe in the pack's glTF folder. */
export const QUATERNIUS_DEER = drive("1iGpXKrqYGyZCPGHPPSuDAoKnOXLhXJ0q");
export const QUATERNIUS_PACK = "https://quaternius.com/packs/ultimateanimatedanimals.html";
export const QUATERNIUS_NOTE = "Quaternius Ultimate Animated Animals, Deer rig and animations (CC0), quaternius.com";

/** Packs a .gltf whose buffer is an embedded data URI into a GLB (what parseGlb reads). */
export function glbFromGltf(text: string): Buffer {
  const json = JSON.parse(text);
  if (json.buffers?.length !== 1) throw new Error("Expected one buffer");
  const uri: string = json.buffers[0].uri;
  const m = /^data:[^;]*;base64,(.*)$/.exec(uri);
  if (!m) throw new Error("Expected an embedded (data URI) buffer");
  const bin = Buffer.from(m[1], "base64");
  delete json.buffers[0].uri;
  json.buffers[0].byteLength = bin.length;
  const pad = (b: Buffer, fill: number) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (data: Buffer, type: number) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)]);
}

/** The deer's glTF as GLB bytes (downloaded once into the cache). */
export function deerGlb(cache: string): Buffer {
  return glbFromGltf(readFileSync(fetchCached(cache, QUATERNIUS_DEER), "utf8"));
}
