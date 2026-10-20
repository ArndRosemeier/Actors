import type { BufferRef, ScalarType } from "@actors/core";

const CTORS = { f32: Float32Array, u32: Uint32Array, u16: Uint16Array, i16: Int16Array, u8: Uint8Array };

/** Accumulates typed arrays into one 4-byte-aligned binary blob. */
export class BlobWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;

  add(type: ScalarType, data: ArrayLike<number>): BufferRef {
    const arr = new CTORS[type](data.length);
    arr.set(data);
    const bytes = new Uint8Array(arr.buffer);
    const offset = this.size;
    this.chunks.push(bytes);
    this.size += bytes.byteLength;
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.size += pad;
    }
    return { offset, count: data.length, type };
  }

  toBuffer(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }
}
