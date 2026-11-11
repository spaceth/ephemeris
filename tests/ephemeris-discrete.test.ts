import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hermite, lagrange, windowStart } from "../src/core/ephemeris/discrete";
import { loadOrder, stateRelative } from "../src/core/ephemeris/resolve";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/discrete-cspice.json", import.meta.url), "utf8"),
) as {
  cases: { body: number; center: number; et: number; stateKm: number[] }[];
};

const bytes = readFileSync(new URL("./fixtures/discrete.bsp", import.meta.url));
const kernels = loadOrder([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)]);

describe("discrete SPK interpolation", () => {
  it("reproduces the published Hermite example", () => {
    const fit = hermite([-1, 0, 3, 5], [6, 5, 2210, 78180], [3, 0, 5115, 109395], 2);
    expect(fit.value).toBeCloseTo(141, 8);
    expect(fit.derivative).toBeCloseTo(456, 6);
  });

  it("returns a stored Lagrange node", () => {
    expect(lagrange([0, 10, 20, 30], [1, 8, 27, 64], 20)).toBe(27);
  });

  it("clamps the window to the ends and gives an interior epoch the later window", () => {
    expect(windowStart(0, 4, 16)).toBe(0);
    expect(windowStart(2, 4, 16)).toBe(1);
    expect(windowStart(15, 4, 16)).toBe(12);
    expect(windowStart(1, 2, 8)).toBe(1);
  });

  it("matches CSPICE on the same type 8, 9, 12, and 13 kernel", () => {
    let positionM = 0;
    let velocityMps = 0;
    for (const item of fixture.cases) {
      const state = stateRelative(kernels, item.body, item.center, item.et, "ICRF");
      expect(state.ok, `${item.body} at ${item.et}`).toBe(true);
      if (!state.ok) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        positionM = Math.max(positionM, Math.abs(state.state.positionM[axis] - item.stateKm[axis] * 1000));
        velocityMps = Math.max(velocityMps, Math.abs(state.state.velocityMps[axis] - item.stateKm[axis + 3] * 1000));
      }
    }
    // Measured against CSPICE N0067 on tests/fixtures/discrete.bsp.
    expect(positionM).toBeLessThan(1e-6);
    expect(velocityMps).toBeLessThan(1e-9);
  });

  it("evaluates a craft relative to its own center with no planetary kernel", () => {
    const state = stateRelative(kernels, -512, 399, 45, "ICRF");
    expect(state.ok).toBe(true);
  });

  it("does not replace a later type 8 segment with the earlier one", () => {
    const early = stateRelative(kernels, -510, 399, 30, "ICRF");
    const late = stateRelative(kernels, -510, 399, 430, "ICRF");
    expect(early.ok && late.ok).toBe(true);
    if (!early.ok || !late.ok) return;
    const earlyCase = fixture.cases.find((item) => item.body === -510 && item.et === 30);
    const lateCase = fixture.cases.find((item) => item.body === -510 && item.et === 430);
    expect(early.state.positionM[1] / 1000).toBeCloseTo(earlyCase?.stateKm[1] ?? 0, 4);
    expect(late.state.positionM[1] / 1000).toBeCloseTo(lateCase?.stateKm[1] ?? 0, 4);
    expect(Math.abs(early.state.positionM[1])).not.toBeCloseTo(Math.abs(late.state.positionM[1]), 0);
  });
});
