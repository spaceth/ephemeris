import { describe, expect, it } from "vitest";
import { chebyshev } from "../src/core/ephemeris/chebyshev";
import { writeSpk } from "../src/core/ephemeris/dafWrite";
import { earthAndMoonFromEmbVector, earthFromEarthMoonVector } from "../src/core/ephemeris/earthMoon";
import { loadOrder, stateRelative } from "../src/core/ephemeris/resolve";
import { EARTH, EMB, MOON, SSB } from "../src/core/ephemeris/state";
import { icrfToEme2000 } from "../src/core/frames";

function type2(target: number, center: number, start: number, stop: number, position: [number, number, number], type = 2) {
  const radius = (stop - start) / 2;
  const mid = start + radius;
  return {
    target,
    center,
    frame: 1,
    type,
    startEt: start,
    stopEt: stop,
    init: start,
    intervalLength: stop - start,
    records: [
      {
        mid,
        radius,
        coefficients: [position[0], 0, position[1], 0, position[2], 0],
      },
    ],
  };
}

describe("Chebyshev", () => {
  it("matches T0 and T1 and the analytic derivative", () => {
    const constant = chebyshev([4], 0.3);
    expect(constant.value).toBeCloseTo(4, 12);
    expect(constant.derivative).toBeCloseTo(0, 12);
    const linear = chebyshev([2, 5], 0.25);
    expect(linear.value).toBeCloseTo(2 + 5 * 0.25, 12);
    expect(linear.derivative).toBeCloseTo(5, 12);
    const quadratic = chebyshev([1, 0, 3], 0.5);
    const t2 = 2 * 0.5 * 0.5 - 1;
    expect(quadratic.value).toBeCloseTo(1 + 3 * t2, 12);
    expect(quadratic.derivative).toBeCloseTo(3 * 4 * 0.5, 12);
  });
});

describe("SPK center chain", () => {
  const moon = type2(MOON, EMB, 0, 100, [384000, 0, 0]);
  const earth = type2(EARTH, EMB, 0, 100, [-384000 / 81.3, 0, 0]);
  const emb = type2(EMB, SSB, 0, 100, [1.5e8, 1000, 0]);

  it("subtracts centers and converts kilometers to meters once", () => {
    const kernels = loadOrder([writeSpk([emb, earth, moon])]);
    const got = stateRelative(kernels, MOON, EARTH, 50, "ICRF");
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const expectedKm = 384000 - -384000 / 81.3;
    expect(got.state.positionM[0]).toBeCloseTo(expectedKm * 1000, 4);
    expect(got.state.positionM[1]).toBeCloseTo(0, 6);
    expect(got.state.velocityMps).toEqual([0, 0, 0]);
    expect(got.state.target).toBe(MOON);
    expect(got.state.center).toBe(EARTH);
    expect(got.state.frame).toBe("ICRF");
    expect(got.state.quality).toEqual([{ kind: "native" }]);
  });

  it("applies the ICRF to EME2000 bias once", () => {
    const kernels = loadOrder([writeSpk([emb, earth, moon])]);
    const icrf = stateRelative(kernels, EMB, SSB, 50, "ICRF");
    const eme = stateRelative(kernels, EMB, SSB, 50, "EME2000");
    expect(icrf.ok && eme.ok).toBe(true);
    if (!icrf.ok || !eme.ok) return;
    expect(eme.state.positionM).toEqual(icrfToEme2000(icrf.state.positionM));
    expect(eme.state.velocityMps).toEqual(icrfToEme2000(icrf.state.velocityMps));
  });

  it("lets a later segment outrank an earlier one", () => {
    const early = type2(EARTH, SSB, 0, 100, [1, 0, 0]);
    const late = type2(EARTH, SSB, 0, 100, [9, 0, 0]);
    const got = stateRelative(loadOrder([writeSpk([early, late])]), EARTH, SSB, 10, "ICRF");
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.state.positionM[0]).toBeCloseTo(9000, 6);
  });

  it("does not fall through an unsupported higher-priority segment", () => {
    const usable = type2(EARTH, SSB, 0, 100, [1, 0, 0]);
    const blocked = type2(EARTH, SSB, 0, 100, [9, 0, 0], 18);
    const got = stateRelative(loadOrder([writeSpk([usable, blocked])]), EARTH, SSB, 10, "ICRF");
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toBe("unsupported-spk-type");
  });

  it("distinguishes a gap from the end of coverage", () => {
    const first = type2(EARTH, SSB, 0, 10, [1, 0, 0]);
    const second = type2(EARTH, SSB, 20, 30, [2, 0, 0]);
    const kernels = loadOrder([writeSpk([first, second])]);
    const gap = stateRelative(kernels, EARTH, SSB, 15, "ICRF");
    const outside = stateRelative(kernels, EARTH, SSB, 40, "ICRF");
    expect(gap.ok).toBe(false);
    expect(outside.ok).toBe(false);
    if (gap.ok || outside.ok) return;
    expect(gap.reason).toBe("gap");
    expect(outside.reason).toBe("outside-coverage");
  });

  it("reports a missing center instead of inventing one", () => {
    const kernels = loadOrder([writeSpk([moon])]);
    const got = stateRelative(kernels, MOON, SSB, 10, "ICRF");
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toBe("missing-dependency");
  });

  it("uses type 2 velocity from the derivative and type 3 velocity from the stored polynomial", () => {
    const radius = 50;
    const typeTwo = {
      target: EARTH,
      center: SSB,
      frame: 1,
      type: 2,
      startEt: 0,
      stopEt: 100,
      init: 0,
      intervalLength: 100,
      records: [
        {
          mid: 50,
          radius,
          coefficients: [0, 10, 0, 0, 0, 0],
        },
      ],
    };
    const at = stateRelative(loadOrder([writeSpk([typeTwo])]), EARTH, SSB, 50, "ICRF");
    expect(at.ok).toBe(true);
    if (!at.ok) return;
    expect(at.state.positionM[0]).toBeCloseTo(0, 6);
    expect(at.state.velocityMps[0]).toBeCloseTo((10 / radius) * 1000, 8);

    const typeThree = {
      target: EARTH,
      center: SSB,
      frame: 1,
      type: 3,
      startEt: 0,
      stopEt: 100,
      init: 0,
      intervalLength: 100,
      records: [
        {
          mid: 50,
          radius,
          coefficients: [1000, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0],
        },
      ],
    };
    const stored = stateRelative(loadOrder([writeSpk([typeThree])]), EARTH, SSB, 75, "ICRF");
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.state.positionM[0]).toBeCloseTo(1000 * 1000, 4);
    expect(stored.state.velocityMps[0]).toBeCloseTo(7 * 1000, 8);
  });
});

describe("Earth-Moon mass ratio", () => {
  it("uses EMRAT for an EMB-to-Moon vector and 1+EMRAT for an Earth-to-Moon vector", () => {
    const emb: [number, number, number] = [10, 0, 0];
    const m: [number, number, number] = [81.3, 0, 0];
    const pair = earthAndMoonFromEmbVector(emb, m, 81.3);
    expect(pair.earth[0]).toBeCloseTo(9, 12);
    expect(pair.moon[0]).toBeCloseTo(91.3, 12);
    const d: [number, number, number] = [82.3, 0, 0];
    const earth = earthFromEarthMoonVector(emb, d, 81.3);
    expect(earth[0]).toBeCloseTo(10 - 82.3 / 82.3, 12);
  });
});
