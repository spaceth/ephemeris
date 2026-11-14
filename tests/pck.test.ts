import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePckRadii } from "../src/core/pck";

describe("PCK radii", () => {
  it("ignores comment blocks, keeps the last data assignment, and accepts a split triple", () => {
    const text = `KPL/PCK
BODY10_RADII = ( 1 1 1 )
\\begindata
BODY10_RADII = ( 696000. 696000. 696000. )
BODY399_RADII = ( 1
  2
  3 )
\\begintext
BODY10_RADII = ( 1 1 1 )
\\begindata
BODY10_RADII = ( 695700 695700 695700 )
BODY901_RADII = ( 605 605 605 )
BODY901_RADII = ( 606 606 606 )
`;
    const radii = parsePckRadii(text);
    expect(radii.get(10)).toEqual([695700, 695700, 695700]);
    expect(radii.get(399)).toEqual([1, 2, 3]);
    expect(radii.get(901)).toEqual([606, 606, 606]);
  });

  it("reads the current radii from pck00011 and not the commented predecessors", () => {
    const text = readFileSync(new URL("../kernels/pck00011.tpc", import.meta.url), "utf8");
    const radii = parsePckRadii(text);
    expect(radii.get(10)).toEqual([695700, 695700, 695700]);
    expect(radii.get(199)?.[0]).toBeCloseTo(2440.53, 2);
    expect(radii.get(199)?.[2]).toBeCloseTo(2438.26, 2);
    expect(radii.get(399)?.[0]).toBeCloseTo(6378.1366, 4);
    expect(radii.get(301)?.[0]).toBeCloseTo(1737.4, 1);
    expect(radii.get(999)?.[0]).toBeCloseTo(1188.3, 1);
    expect(radii.get(901)?.[0]).toBe(606);
  });
});
