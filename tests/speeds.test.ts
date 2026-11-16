import { describe, expect, it } from "vitest";
import { playbackSpeeds, spanPace, speedLabel } from "../src/view/speeds";

const DAY = 86400;

describe("playback speeds", () => {
  it("stays at realtime when the span is about a minute", () => {
    expect(playbackSpeeds(45)).toEqual([1]);
  });

  it("grows exponentially and rounds up onto 1, 2, and 5", () => {
    expect(playbackSpeeds(9 * DAY)).toEqual([1, 20, 200, 2_000, 20_000]);
    for (const speed of playbackSpeeds(9 * DAY)) {
      const exp = Math.floor(Math.log10(speed));
      const mantissa = speed / 10 ** exp;
      expect([1, 2, 5]).toContain(mantissa);
    }
  });

  it("sizes the fastest rate to the whole span", () => {
    const span = 78 * 365.25 * DAY;
    const speeds = playbackSpeeds(span);
    expect(speeds[0]).toBe(1);
    expect(speeds).toHaveLength(5);
    expect(speeds[speeds.length - 1]).toBeGreaterThanOrEqual(span / 60);
    expect(span / speeds[speeds.length - 1]).toBeLessThanOrEqual(60);
    const growth = speeds.slice(1).map((speed, index) => speed / speeds[index]);
    expect(Math.min(...growth)).toBeGreaterThan(1);
  });

  it("labels a rounded rate without a long digit string", () => {
    expect(speedLabel(1)).toBe("1×");
    expect(speedLabel(20_000)).toBe("20k×");
    expect(speedLabel(50_000_000)).toBe("50M×");
  });

  it("describes the full span in a whole unit", () => {
    expect(spanPace(9 * DAY, 20_000)).toBe("39 s");
    expect(spanPace(78 * 365.25 * DAY, 1)).toBe("78 yr");
  });
});
