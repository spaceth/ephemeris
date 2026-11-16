import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Figure = {
  id: string;
  name: string;
  at: [number, number];
  lines: [number, number][][];
};

describe("IAU constellations", () => {
  const packed = JSON.parse(readFileSync("public/constellations.json", "utf8")) as {
    frame: string;
    constellations: Figure[];
  };

  it("ships the d3-celestial figures, with Serpens drawn in two parts", () => {
    expect(packed.frame).toBe("J2000");
    expect(packed.constellations).toHaveLength(89);
    expect(packed.constellations.filter((item) => item.id === "Ser" || item.id.startsWith("Ser-"))).toHaveLength(2);
    const orion = packed.constellations.find((item) => item.id === "Ori");
    expect(orion?.name).toBe("Orion");
    expect(orion?.at[0]).toBeCloseTo(84, 0);
    expect(orion?.lines.length).toBeGreaterThan(0);
  });

  it("keeps every stick on the celestial sphere", () => {
    for (const figure of packed.constellations) {
      expect(figure.name.length).toBeGreaterThan(0);
      expect(figure.at[1]).toBeGreaterThanOrEqual(-90);
      expect(figure.at[1]).toBeLessThanOrEqual(90);
      expect(figure.lines.length).toBeGreaterThan(0);
      for (const segment of figure.lines) {
        expect(segment.length).toBeGreaterThan(1);
        for (const [ra, dec] of segment) {
          expect(ra).toBeGreaterThanOrEqual(-180);
          expect(ra).toBeLessThanOrEqual(180);
          expect(dec).toBeGreaterThanOrEqual(-90);
          expect(dec).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});
