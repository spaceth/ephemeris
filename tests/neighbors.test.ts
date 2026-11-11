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

  it("shows the Moon from Earth and does not repeat the center", () => {
    expect(defaultNeighbors("EARTH").map((body) => body.id)).toEqual([301]);
    expect(defaultNeighbors("MOON").map((body) => body.id)).toEqual([399]);
    expect(defaultNeighbors("SUN").map((body) => body.id)).toEqual([399, 301]);
    expect(defaultNeighbors("MARS")).toEqual([]);
  });
});
