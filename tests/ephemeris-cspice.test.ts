import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { earthAndMoonFromEmbVector } from "../src/core/ephemeris/earthMoon";
import { loadOrder, stateRelative } from "../src/core/ephemeris/resolve";
import { EARTH, EMB, MOON, SSB } from "../src/core/ephemeris/state";
import { eme2000ToIcrf, icrfToEme2000 } from "../src/core/frames";

type FixtureCase = {
  name: string;
  et: number;
  target: number;
  center: number;
  positionKm: [number, number, number];
  velocityKmps: [number, number, number];
};

type Fixture = {
  toolkit: string;
  emrat: number;
  emratEarthSsbResidualKm: number[];
  cases: FixtureCase[];
};

const fixture = JSON.parse(readFileSync("tests/fixtures/de440-cspice.json", "utf8")) as Fixture;
const snapshot = readFileSync("public/ephemeris/de440-earth-moon-sun.bsp");
const kernels = loadOrder([snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength)]);

/**
 * Native coefficient evaluation against CSPICE N0067 on the same DE440 kernel,
 * aberration NONE, frame J2000 (ICRF for this product). The committed snapshot
 * is a byte copy of the overlapping type 2 records.
 * Measured over these epochs: 1.05e-5 m in position and 3.7e-12 m/s in velocity.
 * That is reference rounding, not a kilometer-level drawing tolerance.
 * TDB≈TT, drawing a barycenter as a body, and Earth orientation are separate.
 */
const POSITION_M = 2e-5;
const VELOCITY_MPS = 1e-10;

function meters(km: number): number {
  return km * 1000;
}

describe("CSPICE DE440 reference", () => {
  it("records a same-kernel Earth reconstruction residual below a millimeter", () => {
    const worst = Math.max(...fixture.emratEarthSsbResidualKm.map((value) => Math.abs(value)));
    expect(worst).toBeLessThan(1e-6);
    expect(fixture.toolkit).toBe("CSPICE_N0067");
  });

  it.each(fixture.cases)("$name matches CSPICE position and velocity", (sample: FixtureCase) => {
    const got = stateRelative(kernels, sample.target, sample.center, sample.et, "ICRF");
    expect(got.ok, got.ok ? "" : got.message).toBe(true);
    if (!got.ok) return;
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(got.state.positionM[axis] - meters(sample.positionKm[axis]))).toBeLessThan(POSITION_M);
      expect(Math.abs(got.state.velocityMps[axis] - meters(sample.velocityKmps[axis]))).toBeLessThan(VELOCITY_MPS);
    }
    expect(got.state.frame).toBe("ICRF");
    expect(got.state.quality).toEqual([{ kind: "native" }]);
  });

  it("applies the ICRF to EME2000 bias once", () => {
    const sample = fixture.cases.find((item) => item.name === "j2000-earth-ssb");
    if (!sample) throw new Error("missing earth fixture");
    const eme = stateRelative(kernels, EARTH, SSB, sample.et, "EME2000");
    expect(eme.ok).toBe(true);
    if (!eme.ok) return;
    const expected = icrfToEme2000(sample.positionKm.map(meters) as [number, number, number]);
    expect(Math.abs(eme.state.positionM[0] - expected[0])).toBeLessThan(POSITION_M);
    const back = eme2000ToIcrf(eme.state.positionM);
    expect(Math.abs(back[0] - meters(sample.positionKm[0]))).toBeLessThan(POSITION_M);
    const rawGap = Math.abs(eme.state.positionM[0] - meters(sample.positionKm[0]));
    expect(rawGap).toBeGreaterThan(1);
  });

  it("reconstructs Earth from the Moon and matches the native Earth segment", () => {
    const emb = stateRelative(kernels, EMB, SSB, 0, "ICRF");
    const moon = stateRelative(kernels, MOON, EMB, 0, "ICRF");
    const earth = stateRelative(kernels, EARTH, SSB, 0, "ICRF");
    expect(emb.ok && moon.ok && earth.ok).toBe(true);
    if (!emb.ok || !moon.ok || !earth.ok) return;
    const pair = earthAndMoonFromEmbVector(emb.state.positionM, moon.state.positionM, fixture.emrat);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(pair.earth[axis] - earth.state.positionM[axis])).toBeLessThan(1e-3);
    }
    const velocity = earthAndMoonFromEmbVector(emb.state.velocityMps, moon.state.velocityMps, fixture.emrat);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(velocity.earth[axis] - earth.state.velocityMps[axis])).toBeLessThan(1e-6);
    }
  });

  it("reports a gap outside the snapshot instead of extrapolating", () => {
    const outside = stateRelative(kernels, MOON, EARTH, 1577966400 + 345600, "ICRF");
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.reason === "outside-coverage" || outside.reason === "gap").toBe(true);
  });
});
