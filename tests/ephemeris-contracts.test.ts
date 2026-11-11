import { describe, expect, it } from "vitest";
import { attitudeAt } from "../src/core/ephemeris/attitude";
import { tdbFromTaiClock, tdbSecondsPastJ2000, TT_MINUS_TAI_SECONDS } from "../src/core/ephemeris/scales";
import { EME2000_TO_GCRS, eme2000ToIcrf, GCRS_TO_EME2000, icrfToEme2000, rotateState, sourceToEme2000, ZERO_RATE } from "../src/core/frames";
import { parseUtcEpoch, TimeScaleError } from "../src/core/time";

describe("time contracts", () => {
  it("rejects UTC before 1972 instead of applying the modern leap table", () => {
    expect(() => parseUtcEpoch("1971-12-31T23:59:59")).toThrow(TimeScaleError);
    expect(() => parseUtcEpoch("1971-12-31T23:59:59")).toThrow(/1972/);
  });

  it("converts a TAI Julian date to TDB seconds past J2000 with the named approximation", () => {
    const atJ2000Tai = tdbSecondsPastJ2000(2451545.0, 0);
    expect(atJ2000Tai.secondsPastJ2000).toBeCloseTo(TT_MINUS_TAI_SECONDS, 12);
    expect(atJ2000Tai.quality).toEqual({ kind: "approximate", reason: "tdb-equals-tt" });
  });

  it("places 2000-01-01 12:00 UTC 64.184 s after J2000 TT", () => {
    const parsed = parseUtcEpoch("2000-01-01T12:00:00");
    const tdb = tdbSecondsPastJ2000(parsed.tai1, parsed.tai2);
    expect(tdb.secondsPastJ2000).toBeCloseTo(32 + TT_MINUS_TAI_SECONDS, 9);
    const fromClock = tdbFromTaiClock({ tai1: parsed.tai1, tai2: parsed.tai2 }, 0);
    expect(fromClock.secondsPastJ2000).toBeCloseTo(tdb.secondsPastJ2000, 9);
  });
});

describe("frame bias", () => {
  const sample: [number, number, number] = [1234.5, -678.25, 90.125];

  it("applies the stored matrix once and leaves OEM EME2000 untouched", () => {
    expect(sourceToEme2000("EME2000", sample)).toEqual(sample);
    const turned = icrfToEme2000(sample);
    expect(turned).toEqual(sourceToEme2000("ICRF", sample));
    expect(turned).toEqual(sourceToEme2000("GCRF", sample));
    expect(turned[0]).toBeCloseTo(
      GCRS_TO_EME2000[0][0] * sample[0] + GCRS_TO_EME2000[0][1] * sample[1] + GCRS_TO_EME2000[0][2] * sample[2],
      12,
    );
  });

  it("round-trips the bias through its transpose", () => {
    const back = eme2000ToIcrf(icrfToEme2000(sample));
    expect(back[0]).toBeCloseTo(sample[0], 9);
    expect(back[1]).toBeCloseTo(sample[1], 9);
    expect(back[2]).toBeCloseTo(sample[2], 9);
    expect(EME2000_TO_GCRS[0][1]).toBe(GCRS_TO_EME2000[1][0]);
  });

  it("adds the rotation-rate term only when a derivative is supplied", () => {
    const velocity: [number, number, number] = [1, 2, 3];
    const still = rotateState(GCRS_TO_EME2000, ZERO_RATE, sample, velocity);
    expect(still.position).toEqual(icrfToEme2000(sample));
    expect(still.velocity).toEqual(icrfToEme2000(velocity));
    const rate = [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ] as const;
    const moving = rotateState(GCRS_TO_EME2000, rate, sample, velocity);
    const rotated = icrfToEme2000(velocity);
    expect(moving.velocity[0]).toBeCloseTo(rotated[0] - sample[1], 12);
    expect(moving.velocity[1]).toBeCloseTo(rotated[1] + sample[0], 12);
    expect(moving.velocity[2]).toBeCloseTo(rotated[2], 12);
  });
});

describe("attitude slot", () => {
  it("returns no quaternion until an attitude message is adopted", () => {
    expect(attitudeAt()).toBeNull();
  });
});
