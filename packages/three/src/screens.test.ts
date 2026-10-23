import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ScreenTexturePool, screenPixels, setScreenTexturePool, setScreenColor, updateScreen, useScreenMaterial } from "./screens";

describe("screen textiles", () => {
  it("bounds 64 wearers to four uploads per tick without multiplying time or sharing tints", () => {
    const pool = new ScreenTexturePool();
    const materials = Array.from({ length: 64 }, () => useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color("#abcdef"), pool));
    const textures = [...new Set(materials.map((m) => m.emissiveMap! as THREE.DataTexture))];
    expect(textures).toHaveLength(4);
    const versions = textures.map((t) => t.version);
    const before = textures.map((t) => (t.image.data as Uint8Array).slice());
    pool.update(2);
    // Advancing the clock alone doesn't redraw hidden phases.
    expect(textures.map((t) => t.version)).toEqual(versions);
    for (const m of materials) updateScreen(m, 2);
    expect(textures.map((t, i) => t.version - versions[i])).toEqual([1, 1, 1, 1]);
    for (let i = 0; i < 4; i++) {
      expect(textures[i].image.data).toEqual(screenPixels(2 + i * 5));
      expect(textures[i].image.data).not.toEqual(before[i]);
    }
    for (const m of materials) updateScreen(m, 2);
    expect(textures.map((t, i) => t.version - versions[i])).toEqual([1, 1, 1, 1]);
    setScreenColor(materials[0], "#ff8800");
    expect(materials[4].emissive.getHexString()).toBe("abcdef");
    const disposed = vi.fn();
    textures[0].addEventListener("dispose", disposed);
    materials[0].dispose();
    expect(disposed).not.toHaveBeenCalled();
    pool.update(1);
    updateScreen(materials[4], 1);
    expect(textures[0].image.data).toEqual(screenPixels(3));
    for (const m of materials) m.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it("throttles active phases, ignores invalid deltas, and isolates scene clocks", () => {
    const pool = new ScreenTexturePool(2), other = new ScreenTexturePool(1);
    const a = useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color(), pool);
    const hidden = useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color(), pool);
    const b = useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color(), other);
    const versions = [a, hidden, b].map((m) => m.emissiveMap!.version);
    for (const dt of [0.01, NaN, -1, Infinity]) { pool.update(dt); updateScreen(a, 0.01); }
    expect(a.emissiveMap!.version).toBe(versions[0]);
    pool.update(0.1); updateScreen(a, 0.1); updateScreen(b, 0.1);
    expect([a, hidden, b].map((m, i) => m.emissiveMap!.version - versions[i])).toEqual([1, 0, 0]);
    for (const m of [a, hidden, b]) m.dispose();
    expect(() => new ScreenTexturePool(0)).toThrow(RangeError);
  });

  it("moves materials between pools and private animation without losing tint or leaking textures", () => {
    const pool = new ScreenTexturePool(1), next = new ScreenTexturePool(1);
    const a = useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color("#abcdef"));
    const b = useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color(), pool);
    const privateDisposed = vi.fn();
    a.emissiveMap!.addEventListener("dispose", privateDisposed);
    setScreenColor(a, "#ff8800");
    setScreenTexturePool(a, pool);
    expect(privateDisposed).toHaveBeenCalledOnce();
    expect(a.emissiveMap).toBe(b.emissiveMap);
    setScreenTexturePool(a, pool);
    setScreenTexturePool(a, next);
    const sharedDisposed = vi.fn();
    a.emissiveMap!.addEventListener("dispose", sharedDisposed);
    setScreenTexturePool(a, null);
    expect(sharedDisposed).toHaveBeenCalledOnce();
    updateScreen(a, 1);
    expect((a.emissiveMap! as THREE.DataTexture).image.data).toEqual(screenPixels(1));
    expect(a.emissive.getHexString()).toBe("ff8800");
    setScreenColor(a, null);
    expect(a.emissive.getHexString()).toBe("abcdef");
    a.dispose(); b.dispose();
  });
  it("produces opaque, changing, deterministic pixels without a DOM", () => {
    const first = screenPixels(0);
    expect(first).toEqual(screenPixels(0));
    expect(first).not.toEqual(screenPixels(4));
    for (let i = 3; i < first.length; i += 4) expect(first[i]).toBe(255);
  });

  it("throttles uploads, keeps actors independent, and disposes its texture", () => {
    const a = useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color("#abcdef"));
    const b = useScreenMaterial(new THREE.MeshStandardMaterial(), new THREE.Color("#abcdef"));
    const texture = a.emissiveMap!;
    const version = texture.version;
    updateScreen(a, 0.01);
    expect(texture.version).toBe(version);
    updateScreen(a, 0.1);
    expect(texture.version).toBe(version + 1);
    expect(b.emissiveMap!.version).toBe(version);
    updateScreen(a, NaN);
    updateScreen(a, -1);
    expect(texture.version).toBe(version + 1);
    const disposed = vi.fn();
    texture.addEventListener("dispose", disposed);
    a.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    updateScreen(a, 1);
    expect(texture.version).toBe(version + 1);
    b.dispose();
  });

  it("recolours emission and restores the original palette", () => {
    const original = new THREE.Color("#abcdef");
    const material = useScreenMaterial(new THREE.MeshStandardMaterial(), original);
    setScreenColor(material, "#ff8800");
    expect(material.emissive.getHexString()).toBe("ff8800");
    setScreenColor(material, null);
    expect(material.emissive).toEqual(original);
    expect(material.emissiveMap).toBeInstanceOf(THREE.DataTexture);
    material.dispose();
  });
});
