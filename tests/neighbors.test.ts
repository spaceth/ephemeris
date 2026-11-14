import { describe, expect, it } from "vitest";
import { orbitCenter } from "../src/core/centers";
import { centerNaif, defaultNeighbors } from "../src/core/ephemeris/place";

describe("neighbor centers", () => {
  it("uses the catalog id, including planets the old snapshot could not chain", () => {
    expect(centerNaif("Earth")).toBe(399);
    expect(centerNaif("MOON")).toBe(301);
    expect(centerNaif("EARTH BARYCENTER")).toBe(3);
    expect(centerNaif("MARS")).toBe(499);
    expect(centerNaif("JUPITER")).toBe(599);
    expect(centerNaif("JUPITER BARYCENTER")).toBe(5);
    expect(centerNaif("DIDYMOS")).toBeNull();
  });

  it("lists every other sized body and keeps display radii on the orbit-center table", () => {
    expect(defaultNeighbors("EARTH").map((body) => body.id)).toEqual(
      expect.arrayContaining([10, 301, 199, 499, 599]),
    );
    expect(defaultNeighbors("EARTH").some((body) => body.id === 399)).toBe(false);
    expect(defaultNeighbors("JUPITER BARYCENTER").some((body) => body.id === 599)).toBe(true);
    expect(defaultNeighbors("MARS BARYCENTER").some((body) => body.id === 499)).toBe(true);
    expect(defaultNeighbors("PLUTO BARYCENTER").find((body) => body.id === 999)?.label).toBe("Pluto");
    expect(defaultNeighbors("EARTH BARYCENTER").find((body) => body.id === 399)?.placement).toBe("snapshot");
    expect(defaultNeighbors("DIDYMOS")).toEqual([]);
    expect(defaultNeighbors("MOON").find((body) => body.id === 399)?.radiusKm).toBe(orbitCenter("EARTH")?.radiusKm);
    expect(defaultNeighbors("EARTH").find((body) => body.id === 10)?.radiusKm).toBe(orbitCenter("SUN")?.radiusKm);
    expect(defaultNeighbors("EARTH").find((body) => body.id === 301)?.radiusKm).toBe(orbitCenter("MOON")?.radiusKm);
  });
});
