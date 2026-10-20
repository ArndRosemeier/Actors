import { inflateRawSync } from "node:zlib";

/** One file in a ZIP archive's central directory. */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeader: number;
}

function findEocd(tail: Buffer): number {
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) return i;
  throw new Error("Not a zip file (no end-of-central-directory record)");
}

/** Where the central directory sits, read from the archive's last bytes (64 KiB + 22 is always enough). */
export function centralDirectoryRange(tail: Buffer): { offset: number; size: number; count: number } {
  const e = findEocd(tail);
  return { count: tail.readUInt16LE(e + 10), size: tail.readUInt32LE(e + 12), offset: tail.readUInt32LE(e + 16) };
}

export function parseCentralDirectory(cd: Buffer, count: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let k = 0; k < count; k++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("Bad zip central directory");
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      localHeader: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Length of an entry's local header (fixed part + name + extra field). */
export const localHeaderLength = (header: Buffer) => 30 + header.readUInt16LE(26) + header.readUInt16LE(28);

export function decompress(entry: ZipEntry, raw: Buffer): Buffer {
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`Unsupported zip method ${entry.method} for ${entry.name}`);
}

/** Minimal in-memory ZIP reader (stored + deflate entries), enough for asset archives. */
export function readZip(buf: Buffer): Map<string, () => Buffer> {
  const { offset, size, count } = centralDirectoryRange(buf.subarray(Math.max(0, buf.length - 65557)));
  const out = new Map<string, () => Buffer>();
  for (const e of parseCentralDirectory(buf.subarray(offset, offset + size), count)) {
    out.set(e.name, () => {
      const start = e.localHeader + localHeaderLength(buf.subarray(e.localHeader));
      return decompress(e, buf.subarray(start, start + e.compressedSize));
    });
  }
  return out;
}
