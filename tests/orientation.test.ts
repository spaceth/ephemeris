import { describe, expect, it } from "vitest";
import { earthAttitude, gmst2006, nutation2000b } from "../src/core/ephemeris/orientation";

const J2000 = 2451545.0;

/**
 * ERFA eraNut00b / eraGmst06 / eraObl06 / eraEect00 at the same dates.
 * Greenwich sidereal time is GMST plus dpsi*cos(eps) plus the complementary terms.
 */
const ERFA = {
  j2000: {
    dpsi: -6.7542612539922347e-5,
    deps: -2.7970923310985653e-5,
    gmst: 4.8949612831508285,
    gst: 4.8948993242232284,
  },
  century: {
    dpsi: 1.5866778139452494e-5,
    deps: 4.1620576187031157e-5,
    gmst: 4.9084066632712826,
    gst: 4.9084212200354731,
  },
};

describe("Earth orientation", () => {
  it("matches the IAU 2000B nutation and the IAU 2006 sidereal angle", () => {
    const now = nutation2000b(J2000);
    expect(now.dpsi).toBeCloseTo(ERFA.j2000.dpsi, 12);
    expect(now.deps).toBeCloseTo(ERFA.j2000.deps, 12);
    expect(gmst2006(J2000, J2000)).toBeCloseTo(ERFA.j2000.gmst, 12);
    const century = J2000 + 36525;
    const later = nutation2000b(century);
    expect(later.dpsi).toBeCloseTo(ERFA.century.dpsi, 12);
    expect(later.deps).toBeCloseTo(ERFA.century.deps, 12);
    expect(gmst2006(century, century)).toBeCloseTo(ERFA.century.gmst, 12);
  });

  it("reports approximate UT1 and unavailable polar motion when no bulletin is loaded", () => {
    const attitude = earthAttitude(J2000, J2000);
    expect(attitude.ut1).toBe("approximate");
    expect(attitude.polarMotion).toBe("unavailable");
    expect(attitude.bulletin).toBeNull();
    expect(attitude.greenwichSiderealRad).toBeCloseTo(ERFA.j2000.gst, 12);
    const moved = earthAttitude(J2000, J2000, { xpRad: 1e-6, ypRad: -2e-6 });
    expect(moved.polarMotion).toBe("observed");
    expect(moved.bulletin).toBeNull();
    const delta = attitude.itrfToEme2000.reduce(
      (sum, value, index) => sum + Math.abs(value - moved.itrfToEme2000[index]),
      0,
    );
    expect(delta).toBeGreaterThan(1e-6);
  });
});
