import { describe, expect, it } from "vitest";
import * as THREE from "three";

/**
 * Logarithmic depth, the same function Three.js writes when
 * `logarithmicDepthBuffer` is set. `w` is the clip-space w of a perspective
 * camera, which is the positive view-space depth.
 */
function logDepth(far: number, viewDepth: number): number {
  const factor = 2 / (Math.log(far + 1) / Math.LN2);
  return Math.log2(1 + viewDepth) * factor * 0.5;
}

describe("scene depth", () => {
  it("separates a spacecraft, the Moon, and the Sun under logarithmic depth at the system far plane", () => {
    const far = 1e9;
    const craft = logDepth(far, 7000);
    const moon = logDepth(far, 384_000);
    const sun = logDepth(far, 1.496e8);
    expect(Math.abs(moon - craft)).toBeGreaterThan(1e-4);
    expect(Math.abs(sun - moon)).toBeGreaterThan(1e-4);
    expect(sun).toBeGreaterThan(moon);
    expect(moon).toBeGreaterThan(craft);
  });

  it("clips a body at 1 AU when far stays at the trajectory floor of 1e8 km", () => {
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.02, 1e8);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const clip = new THREE.Vector4(0, 0, -1.496e8, 1)
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);
    expect(clip.z / clip.w).toBeGreaterThan(1);
  });
});
