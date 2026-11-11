import { describe, expect, it } from "vitest";
import { cutSpk } from "../src/core/ephemeris/cut";
import { writeSpk } from "../src/core/ephemeris/dafWrite";
import { loadOrder, stateRelative } from "../src/core/ephemeris/resolve";
import { EARTH, SSB } from "../src/core/ephemeris/state";

function records(values: number[]) {
  return values.map((value, index) => ({
    mid: index * 10 + 5,
    radius: 5,
    coefficients: [value, 0, 0, 0, 0, 0],
  }));
}

describe("SPK window cut", () => {
  const source = writeSpk([
    {
      target: EARTH,
      center: SSB,
      frame: 1,
      type: 2,
      startEt: 0,
      stopEt: 40,
      init: 0,
      intervalLength: 10,
      records: records([1, 2, 3, 4]),
    },
  ]);

  it("keeps native records that overlap the window, including the record that owns the end boundary", () => {
    const cut = cutSpk(source, [EARTH], 10, 30);
    expect(cut.segments).toHaveLength(1);
    const segment = cut.segments[0];
    expect(segment.center).toBe(SSB);
    expect(segment.type).toBe(2);
    expect(segment.degree).toBe(1);
    expect(segment.intervalLength).toBe(10);
    expect(segment.init).toBe(10);
    expect(segment.count).toBe(3);
    expect(segment.startEt).toBe(10);
    expect(segment.stopEt).toBe(40);
    const full = loadOrder([source]);
    const trimmed = loadOrder([cut.buffer]);
    for (const et of [15, 20, 30]) {
      const a = stateRelative(full, EARTH, SSB, et, "ICRF");
      const b = stateRelative(trimmed, EARTH, SSB, et, "ICRF");
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(b.state.positionM[0]).toBeCloseTo(a.state.positionM[0], 9);
      expect(b.state.velocityMps[0]).toBeCloseTo(a.state.velocityMps[0], 9);
    }
    const before = stateRelative(trimmed, EARTH, SSB, 5, "ICRF");
    expect(before.ok).toBe(false);
  });
});
