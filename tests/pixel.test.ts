import { describe, expect, it } from "vitest";
import { projectedDiameterPx } from "../src/view/pixel";

describe("planet pixel", () => {
  it("shrinks a distant planet below one pixel and fills the frame up close", () => {
    const far = projectedDiameterPx(42, 6e9, 6378, 800);
    const near = projectedDiameterPx(42, 20000, 6378, 800);
    expect(far).toBeLessThan(1);
    expect(near).toBeGreaterThan(1);
    expect(projectedDiameterPx(42, 1000, 6378, 800)).toBe(800);
  });
});
