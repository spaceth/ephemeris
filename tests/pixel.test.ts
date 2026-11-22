import { describe, expect, it } from "vitest";
import {
  PLANET_ORBIT_FULL_PX,
  PLANET_ORBIT_HIDDEN_PX,
  planetOrbitOpacity,
  projectedDiameterPx,
} from "../src/view/pixel";

describe("planet pixel", () => {
  it("shrinks a distant planet below one pixel and fills the frame up close", () => {
    const far = projectedDiameterPx(42, 6e9, 6378, 800);
    const near = projectedDiameterPx(42, 20000, 6378, 800);
    expect(far).toBeLessThan(1);
    expect(near).toBeGreaterThan(1);
    expect(projectedDiameterPx(42, 1000, 6378, 800)).toBe(800);
  });

  it("fades a planet orbit line from solid when the planet is almost gone to clear when close", () => {
    expect(planetOrbitOpacity(0)).toBe(1);
    expect(planetOrbitOpacity(PLANET_ORBIT_FULL_PX)).toBe(1);
    expect(planetOrbitOpacity(PLANET_ORBIT_HIDDEN_PX)).toBe(0);
    expect(planetOrbitOpacity(PLANET_ORBIT_HIDDEN_PX * 4)).toBe(0);
    expect(planetOrbitOpacity(32)).toBe(0);
    const mid = (PLANET_ORBIT_FULL_PX + PLANET_ORBIT_HIDDEN_PX) / 2;
    const fading = planetOrbitOpacity(mid);
    const step = (PLANET_ORBIT_HIDDEN_PX - PLANET_ORBIT_FULL_PX) / 4;
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(planetOrbitOpacity(mid - step)).toBeGreaterThan(fading);
    expect(planetOrbitOpacity(mid + step)).toBeLessThan(fading);
  });
});
