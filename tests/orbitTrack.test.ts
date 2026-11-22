import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { place } from "../src/core/ephemeris/place";
import { loadOrder } from "../src/core/ephemeris/resolve";
import { DEFAULT_ORBITS, ORBIT_PILLS, orbitTrackSpecs, sampleOrbit } from "../src/view/orbitTrack";

const snapshot = readFileSync("public/ephemeris/de440-earth-moon-sun.bsp");
const kernels = loadOrder([snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength)]);
const AU = 149_597_870_700;

function meanRadius(samples: Float32Array): number {
  const count = samples.length / 3 - 1;
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    sum += Math.hypot(samples[offset], samples[offset + 1], samples[offset + 2]);
  }
  return sum / count;
}

describe("orbit lines", () => {
  it("draws a closed Earth revolution about the Sun and a smaller Mercury one", () => {
    const earth = sampleOrbit(399, 10, 365.256, 0, kernels);
    const mercury = sampleOrbit(199, 10, 87.969, 0, kernels);
    expect(earth).not.toBeNull();
    expect(mercury).not.toBeNull();
    if (!earth || !mercury) return;
    expect(earth[0]).toBe(earth[earth.length - 3]);
    expect(earth[1]).toBe(earth[earth.length - 2]);
    expect(earth[2]).toBe(earth[earth.length - 1]);
    expect(meanRadius(earth) / AU).toBeGreaterThan(0.98);
    expect(meanRadius(earth) / AU).toBeLessThan(1.02);
    expect(meanRadius(mercury) / AU).toBeGreaterThan(0.3);
    expect(meanRadius(mercury) / AU).toBeLessThan(0.5);
  });

  it("draws the Moon about the Earth", () => {
    const moon = sampleOrbit(301, 399, 27.321661, 0, kernels);
    expect(moon).not.toBeNull();
    if (!moon) return;
    expect(moon[0]).toBe(moon[moon.length - 3]);
    expect(meanRadius(moon)).toBeGreaterThan(3.4e8);
    expect(meanRadius(moon)).toBeLessThan(4.2e8);
  });

  it("keeps every ring off until its pill is on", () => {
    expect(orbitTrackSpecs(DEFAULT_ORBITS)).toEqual([]);
    const earth = orbitTrackSpecs({ ...DEFAULT_ORBITS, earth: true });
    expect(earth.map((track) => track.bodyId)).toEqual([399]);
    expect(earth.every((track) => track.fade)).toBe(true);
    const moons = orbitTrackSpecs({ ...DEFAULT_ORBITS, "planet-moons": true });
    expect(moons.some((track) => track.bodyId === 301)).toBe(false);
    expect(moons.map((track) => track.bodyId)).toContain(501);
    expect(moons.every((track) => track.anchorId !== 10)).toBe(true);
    expect(moons.every((track) => track.fade !== true)).toBe(true);
    const earthMoon = orbitTrackSpecs({ ...DEFAULT_ORBITS, "earth-moon": true });
    expect(earthMoon.map((track) => track.bodyId)).toEqual([301]);
    expect(earthMoon[0]?.fade).not.toBe(true);
    const planets = orbitTrackSpecs({
      ...DEFAULT_ORBITS,
      mercury: true,
      venus: true,
      earth: true,
      mars: true,
      jupiter: true,
      saturn: true,
      uranus: true,
      neptune: true,
      pluto: true,
    });
    expect(planets.map((track) => track.bodyId)).toEqual([199, 299, 399, 499, 599, 699, 799, 899, 999]);
    expect(planets.every((track) => track.fade)).toBe(true);
  });

  it("places Saturn after Jupiter", () => {
    const labels = ORBIT_PILLS.map((item) => item.label);
    expect(labels.indexOf("Saturn")).toBe(labels.indexOf("Jupiter") + 1);
    const saturn = orbitTrackSpecs({ ...DEFAULT_ORBITS, saturn: true });
    expect(saturn.map((track) => track.bodyId)).toEqual([699]);
    expect(saturn[0]?.anchorId).toBe(10);
    const line = sampleOrbit(699, 10, 10759.22, 0, kernels);
    expect(line).not.toBeNull();
    if (!line) return;
    expect(line[0]).toBe(line[line.length - 3]);
    expect(meanRadius(line) / AU).toBeGreaterThan(9);
    expect(meanRadius(line) / AU).toBeLessThan(10);
  });

  it("closes Neptune and Pluto past the snapshot window", () => {
    const neptune = sampleOrbit(899, 10, 60189, 0, kernels);
    const pluto = sampleOrbit(999, 10, 90560, 0, kernels);
    expect(neptune).not.toBeNull();
    expect(pluto).not.toBeNull();
    if (!neptune || !pluto) return;
    expect(neptune[0]).toBe(neptune[neptune.length - 3]);
    expect(pluto[0]).toBe(pluto[pluto.length - 3]);
    expect(turnAboutOrigin(neptune)).toBeGreaterThan(6);
    expect(turnAboutOrigin(pluto)).toBeGreaterThan(6);
    const neptuneRadii = radiiAu(neptune);
    const plutoRadii = radiiAu(pluto);
    expect(Math.min(...neptuneRadii)).toBeGreaterThan(29);
    expect(Math.max(...neptuneRadii)).toBeLessThan(31);
    expect(Math.min(...plutoRadii)).toBeLessThan(32);
    expect(Math.max(...plutoRadii)).toBeGreaterThan(45);
    expect(nearestAu(neptune, 899)).toBeLessThan(0.8);
    expect(nearestAu(pluto, 999)).toBeLessThan(1.2);
  });
});

function turnAboutOrigin(samples: Float32Array): number {
  const count = samples.length / 3 - 1;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const from = index * 3;
    const to = from + 3;
    const dot = samples[from] * samples[to] + samples[from + 1] * samples[to + 1] + samples[from + 2] * samples[to + 2];
    const cross = Math.hypot(
      samples[from + 1] * samples[to + 2] - samples[from + 2] * samples[to + 1],
      samples[from + 2] * samples[to] - samples[from] * samples[to + 2],
      samples[from] * samples[to + 1] - samples[from + 1] * samples[to],
    );
    total += Math.atan2(cross, dot);
  }
  return total;
}

function radiiAu(samples: Float32Array): number[] {
  const radii: number[] = [];
  for (let index = 0; index < samples.length; index += 3) {
    radii.push(Math.hypot(samples[index], samples[index + 1], samples[index + 2]) / AU);
  }
  return radii;
}

function nearestAu(samples: Float32Array, bodyId: number): number {
  const placed = place(bodyId, 10, kernels, 0);
  if (!placed.ok) return Infinity;
  let best = Infinity;
  for (let index = 0; index < samples.length; index += 3) {
    const distance = Math.hypot(
      samples[index] - placed.positionM[0],
      samples[index + 1] - placed.positionM[1],
      samples[index + 2] - placed.positionM[2],
    );
    if (distance < best) best = distance;
  }
  return best / AU;
}
