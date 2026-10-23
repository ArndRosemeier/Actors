import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { screenPixels, setScreenColor, updateScreen, useScreenMaterial } from "./screens";

describe("screen textiles", () => {
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
