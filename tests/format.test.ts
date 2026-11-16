import { describe, expect, it } from "vitest";
import { formatTaiSeconds } from "../src/core/time";
import { utcTextToSeconds } from "../src/view/format";
import { SOLAR_ORIGIN } from "../src/view/solar";

describe("utc text entry", () => {
  it("reads the ISO string the clock shows", () => {
    const seconds = utcTextToSeconds(SOLAR_ORIGIN, "2024-06-01T12:30:00.125");
    expect(formatTaiSeconds(SOLAR_ORIGIN, seconds, 3).text).toBe("2024-06-01T12:30:00.125");
  });

  it("accepts a space, a trailing Z, and a time with no seconds", () => {
    const exact = utcTextToSeconds(SOLAR_ORIGIN, "2024-06-01T12:30:00");
    expect(utcTextToSeconds(SOLAR_ORIGIN, "2024-06-01 12:30:00")).toBeCloseTo(exact, 6);
    expect(utcTextToSeconds(SOLAR_ORIGIN, "2024-06-01T12:30:00Z")).toBeCloseTo(exact, 6);
    expect(utcTextToSeconds(SOLAR_ORIGIN, "2024-06-01T12:30")).toBeCloseTo(exact, 6);
  });

  it("rejects text that is not a UTC instant", () => {
    expect(() => utcTextToSeconds(SOLAR_ORIGIN, "next tuesday")).toThrow();
  });
});
