import { describe, expect, it } from "vitest";
import { centerNaif, defaultNeighbors } from "../src/core/ephemeris/place";

describe("neighbor defaults", () => {
  it("maps Earth and the Moon and leaves planet barycenters unmapped", () => {
    expect(centerNaif("Earth")).toBe(399);
    expect(centerNaif("MOON")).toBe(301);
    expect(centerNaif("EARTH BARYCENTER")).toBe(3);
    expect(centerNaif("MARS")).toBeNull();
    expect(centerNaif("JUPITER")).toBeNull();
  });

  it("shows the Sun from every placed center and does not repeat the center", () => {
    expect(defaultNeighbors("EARTH").map((body) => body.id)).toEqual([10, 301]);
    expect(defaultNeighbors("MOON").map((body) => body.id)).toEqual([10, 399]);
    expect(defaultNeighbors("SUN").map((body) => body.id)).toEqual([399, 301]);
    expect(defaultNeighbors("EARTH BARYCENTER").map((body) => body.id)).toEqual([10, 399, 301]);
    expect(defaultNeighbors("SOLAR SYSTEM BARYCENTER").map((body) => body.id)).toEqual([10, 399, 301]);
    expect(defaultNeighbors("MARS")).toEqual([]);
  });
});
