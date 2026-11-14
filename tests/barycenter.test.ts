import { describe, expect, it } from "vitest";
import { planetFromBarycenter } from "../src/core/ephemeris/barycenter";
import { parsePckPoles } from "../src/core/pck";
import { readFileSync } from "node:fs";

function length(v: readonly number[]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("planet about its barycenter", () => {
  it("leaves a planet with no retained satellites on the barycenter", () => {
    expect(planetFromBarycenter(199, 0)?.positionKm).toEqual([0, 0, 0]);
    expect(planetFromBarycenter(299, 0)?.velocityKmS).toEqual([0, 0, 0]);
    expect(planetFromBarycenter(499, 86_400)?.positionKm).toEqual([0, 0, 0]);
  });

  it("puts Pluto on Charon's circular orbit, outside the body, at a fixed distance", () => {
    const distance = 19600 * 106.1 / (869.3 + 106.1);
    const atEpoch = planetFromBarycenter(999, 0);
    const later = planetFromBarycenter(999, 6.387222 * 86400);
    expect(atEpoch).not.toBeNull();
    expect(later).not.toBeNull();
    if (!atEpoch || !later) return;
    expect(length(atEpoch.positionKm)).toBeCloseTo(distance, 6);
    expect(length(later.positionKm)).toBeCloseTo(distance, 4);
    expect(distance).toBeGreaterThan(1188.3);
    expect(Math.abs(dot(atEpoch.positionKm, atEpoch.velocityKmS))).toBeLessThan(1e-6);
  });

  it("keeps Jupiter inside its own radius and moving", () => {
    const now = planetFromBarycenter(599, 0);
    const next = planetFromBarycenter(599, 86400);
    expect(now).not.toBeNull();
    expect(next).not.toBeNull();
    if (!now || !next) return;
    expect(length(now.positionKm)).toBeGreaterThan(1);
    expect(length(now.positionKm)).toBeLessThan(71492);
    expect(length(now.positionKm)).toBeLessThan(250);
    const shift = length([
      next.positionKm[0] - now.positionKm[0],
      next.positionKm[1] - now.positionKm[1],
      next.positionKm[2] - now.positionKm[2],
    ]);
    expect(shift).toBeGreaterThan(1);
  });

  it("matches a central difference of the position", () => {
    const dt = 20;
    const before = planetFromBarycenter(899, -dt);
    const after = planetFromBarycenter(899, dt);
    const now = planetFromBarycenter(899, 0);
    expect(before && after && now).toBeTruthy();
    if (!before || !after || !now) return;
    for (let axis = 0; axis < 3; axis += 1) {
      const rate = (after.positionKm[axis] - before.positionKm[axis]) / (2 * dt);
      expect(rate).toBeCloseTo(now.velocityKmS[axis], 8);
    }
  });

  it("stays in the PCK equator", () => {
    const text = readFileSync(new URL("../kernels/pck00011.tpc", import.meta.url), "utf8");
    const pole = parsePckPoles(text).get(599);
    expect(pole).toBeDefined();
    if (!pole) return;
    const ra = pole.raDeg * Math.PI / 180;
    const dec = pole.decDeg * Math.PI / 180;
    const north = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const offset = planetFromBarycenter(599, 10_000);
    expect(offset).not.toBeNull();
    if (!offset) return;
    expect(Math.abs(dot(offset.positionKm, north))).toBeLessThan(1e-6);
    expect(pole.raDeg).toBeCloseTo(268.056595, 6);
  });
});
