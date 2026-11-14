import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planetFromBarycenter } from "../src/core/ephemeris/barycenter";
import { orbitCenter } from "../src/core/centers";
import { bodyByName, neighborsOf } from "../src/core/ephemeris/bodies";
import { loadOrder } from "../src/core/ephemeris/resolve";
import {
  centerNaif,
  defaultNeighbors,
  place,
  placeCenter,
  placementRecord,
  resetPlacementRecord,
} from "../src/core/ephemeris/place";

const snapshot = readFileSync("public/ephemeris/de440-earth-moon-sun.bsp");
const kernels = loadOrder([snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength)]);

describe("body catalog", () => {
  it("gives every sized body one record and leaves textures empty except Earth, the Moon, and Jupiter", () => {
    const textured = neighborsOf("SOLAR SYSTEM BARYCENTER")
      .filter((body) => body.texture)
      .map((body) => body.texture);
    expect(textured).toEqual(["/textures/earth-day.jpg", "/textures/moon.jpg", "/textures/jupiter.jpg"]);
    expect(bodyByName("JUPITER")?.attitude).toBe("none");
    expect(bodyByName("MARS")?.placement).toBe("barycenter-offset");
    expect(bodyByName("MERCURY")?.placement).toBe("snapshot");
    expect(bodyByName("EARTH")?.radiusKm).toBe(orbitCenter("EARTH")?.radiusKm);
  });

  it("chains a named center and leaves an unlisted center unresolved", () => {
    expect(centerNaif("Earth")).toBe(399);
    expect(centerNaif("MOON")).toBe(301);
    expect(centerNaif("EARTH BARYCENTER")).toBe(3);
    expect(centerNaif("MARS")).toBe(499);
    expect(centerNaif("JUPITER")).toBe(599);
    expect(centerNaif("JUPITER BARYCENTER")).toBe(5);
    expect(centerNaif("DIDYMOS")).toBeNull();
  });

  it("draws every other sized body, and the planet about its own barycenter", () => {
    const earth = defaultNeighbors("EARTH").map((body) => body.id);
    expect(earth).not.toContain(399);
    expect(earth).toEqual(expect.arrayContaining([10, 301, 199, 299, 499, 599, 699, 799, 899, 999]));
    expect(defaultNeighbors("JUPITER BARYCENTER").map((body) => body.id)).toContain(599);
    expect(defaultNeighbors("JUPITER").some((body) => body.id === 599)).toBe(false);
    expect(defaultNeighbors("EARTH BARYCENTER").find((body) => body.id === 399)?.placement).toBe("snapshot");
    expect(defaultNeighbors("PLUTO BARYCENTER").find((body) => body.id === 999)?.label).toBe("Pluto");
    expect(defaultNeighbors("DIDYMOS")).toEqual([]);
    expect(defaultNeighbors("EARTH").find((body) => body.id === 10)?.radiusKm).toBe(orbitCenter("SUN")?.radiusKm);
    expect(defaultNeighbors("MOON").find((body) => body.id === 399)?.radiusKm).toBe(orbitCenter("EARTH")?.radiusKm);
  });
});

describe("place", () => {
  it("returns the circle-rule offset of Jupiter about its barycenter", () => {
    const placed = place(599, 5, [], 0);
    const offset = planetFromBarycenter(599, 0);
    expect(placed.ok).toBe(true);
    expect(offset).not.toBeNull();
    if (!placed.ok || !offset) return;
    expect(placed.positionM[0]).toBeCloseTo(offset.positionKm[0] * 1000, 6);
    expect(placed.quality.some((item) => item.kind === "approximate" && item.reason === "barycenter-circle")).toBe(true);
    const reach = Math.hypot(placed.positionM[0], placed.positionM[1], placed.positionM[2]) / 1000;
    expect(reach).toBeGreaterThan(1);
    expect(reach).toBeLessThan(250);
  });

  it("places the Sun from the Jupiter barycenter and records a missing chain", () => {
    resetPlacementRecord();
    const sun = place(10, 5, kernels, 0);
    expect(sun.ok).toBe(true);
    if (!sun.ok) return;
    expect(Math.hypot(sun.positionM[0], sun.positionM[1], sun.positionM[2])).toBeGreaterThan(1e11);
    const missing = placeCenter("CERES", "EARTH", kernels, 0);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe("unresolved-center");
    expect(placementRecord().some((item) => item.message === missing.message)).toBe(true);
    const same = placeCenter("EARTH", "Earth", kernels, 0);
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.positionM).toEqual([0, 0, 0]);
  });
});
