import { describe, expect, it } from "vitest";
import { formatTaiSeconds } from "../src/core/time";
import {
  ISO_EDIT_MASK,
  isoEditValue,
  isoMaskArrow,
  isoMaskBackspace,
  isoMaskDelete,
  isoMaskPaste,
  isoMaskSnap,
  isoMaskType,
  utcTextToSeconds,
} from "../src/view/format";
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

describe("iso edit mask", () => {
  const filled = "2024-06-01T12:30:45";

  it("opens on the fixed calendar format and drops a fraction", () => {
    expect(isoEditValue("2024-06-01T12:30:00.125")).toBe("2024-06-01T12:30:00");
    expect(isoEditValue("2024-06-01T12:30:00.125Z")).toBe("2024-06-01T12:30:00");
  });

  it("keeps the skeleton and takes digits one slot at a time", () => {
    let text = ISO_EDIT_MASK;
    let caret = 0;
    for (const digit of "20240601123045") {
      const next = isoMaskType(text, caret, caret, digit);
      text = next.text;
      caret = next.caret;
    }
    expect(text).toBe(filled);
    expect(caret).toBe(ISO_EDIT_MASK.length);
  });

  it("skips separators while the digits are typed", () => {
    const year = isoMaskType(ISO_EDIT_MASK, 0, 0, "2024");
    expect(year).toEqual({ text: "2024-MM-DDThh:mm:ss", caret: 5 });
    const month = isoMaskType(year.text, year.caret, year.caret, "06");
    expect(month.text).toBe("2024-06-DDThh:mm:ss");
    expect(month.caret).toBe(8);
  });

  it("replaces a selection instead of shifting later digits", () => {
    expect(isoMaskType(filled, 0, ISO_EDIT_MASK.length, "1")).toEqual({ text: "1YYY-MM-DDThh:mm:ss", caret: 1 });
    expect(isoMaskType(filled, 5, 5, "11").text).toBe("2024-11-01T12:30:45");
  });

  it("ignores a typed separator", () => {
    expect(isoMaskPaste(filled, 4, 4, "-").text).toBe(filled);
  });

  it("backspaces the digit before the caret and skips separators", () => {
    expect(isoMaskBackspace(filled, 5, 5)).toEqual({ text: "202Y-06-01T12:30:45", caret: 3 });
    expect(isoMaskBackspace(filled, 11, 11).text).toBe("2024-06-0DT12:30:45");
  });

  it("clears the selected digits", () => {
    expect(isoMaskBackspace(filled, 5, 7)).toEqual({ text: "2024-MM-01T12:30:45", caret: 5 });
    expect(isoMaskDelete(filled, 11, 11).text).toBe("2024-06-01Th2:30:45");
  });

  it("pastes a formatted timestamp and drops the fraction", () => {
    expect(isoMaskPaste(ISO_EDIT_MASK, 0, ISO_EDIT_MASK.length, "2024-06-01T12:30:00.125Z").text).toBe("2024-06-01T12:30:00");
    expect(isoMaskPaste(ISO_EDIT_MASK, 4, 4, "2024-06-01 12:30").text).toBe("2024-06-01T12:30:00");
    expect(isoMaskPaste(ISO_EDIT_MASK, 0, 0, "2024-06-01t12:30:45+00:00").text).toBe(filled);
  });

  it("pastes a day-of-year epoch as a calendar date", () => {
    expect(isoMaskPaste(ISO_EDIT_MASK, 0, 0, "2024-153T12:30:00").text).toBe("2024-06-01T12:30:00");
  });

  it("pastes raw digits at the caret", () => {
    expect(isoMaskPaste(filled, 11, 11, "0830").text).toBe("2024-06-01T08:30:45");
  });

  it("pastes a punctuated timestamp that is not already ISO", () => {
    expect(isoMaskPaste(filled, 6, 6, "2024/06/01 12:30:45").text).toBe(filled);
    expect(isoMaskPaste(filled, 11, 11, "20240601T083000").text).toBe("2024-06-01T08:30:00");
  });

  it("moves across separators and snaps a caret off them", () => {
    expect(isoMaskArrow(3, 1)).toBe(5);
    expect(isoMaskArrow(5, -1)).toBe(3);
    expect(isoMaskArrow(0, -1)).toBe(0);
    expect(isoMaskArrow(ISO_EDIT_MASK.length, 1)).toBe(ISO_EDIT_MASK.length);
    expect(isoMaskSnap(4)).toBe(5);
    expect(isoMaskSnap(10)).toBe(11);
    expect(isoMaskSnap(5)).toBe(5);
    expect(isoMaskSnap(0)).toBe(0);
  });
});
