import { describe, expect, it } from "vitest";
import {
  EXPORT_FPS,
  frameStep,
  frameTimes,
  moveTrim,
  nextWindow,
  stillName,
  windowEnd,
} from "../src/view/capture";

describe("frame export", () => {
  it("steps with the playback clock", () => {
    expect(frameStep(1)).toBe(1 / EXPORT_FPS);
    expect(frameStep(3600)).toBe(120);
  });

  it("keeps a full window inside a hundred frames", () => {
    const step = frameStep(3600);
    const end = windowEnd(1_000, step, 1_000_000);
    expect(end - 1_000).toBe(99 * step);
    expect(frameTimes(1_000, end, step)).toHaveLength(100);
  });

  it("saves a short remainder as fewer frames", () => {
    const step = frameStep(3600);
    const times = frameTimes(9_000, 10_000, step);
    expect(times).toHaveLength(9);
    expect(times[0]).toBe(9_000);
    expect(times.at(-1)).toBe(9_960);
  });

  it("advances the next window by the frames just saved", () => {
    const step = frameStep(1);
    const start = 10;
    const end = windowEnd(start, step, 100);
    const saved = frameTimes(start, end, step).length;
    expect(nextWindow(start, end, step, 100, saved)).toEqual({
      start: start + saved * step,
      end: start + saved * step + (end - start),
    });
  });

  it("pins the next window to the end of coverage", () => {
    const step = 120;
    const times = frameTimes(9_000, 10_000, step);
    expect(nextWindow(9_000, 10_000, step, 10_000, times.length)).toEqual({ start: 10_000, end: 10_000 });
  });

  it("refuses a selection longer than the cap", () => {
    const maxSpan = frameStep(30) * 99;
    expect(moveTrim("end", 0, 10_000, 0, 1, 0, 10_000, maxSpan)).toEqual({ start: 0, end: maxSpan });
    expect(moveTrim("start", 50, 0, 40, 50, 0, 100, 20)).toEqual({ start: 30, end: 50 });
  });

  it("drags the window without changing its length", () => {
    expect(moveTrim("move", 10, 25, 10, 20, 0, 100, 50)).toEqual({ start: 25, end: 35 });
    expect(moveTrim("move", 10, 0, 10, 20, 0, 100, 50)).toEqual({ start: 0, end: 10 });
    expect(moveTrim("move", 80, 100, 80, 90, 0, 100, 50)).toEqual({ start: 90, end: 100 });
  });

  it("names a still from the ISO time", () => {
    expect(stillName("2026-11-12T17:42:01.000Z")).toBe("ephemeris-2026-11-12T17-42-01-000Z.png");
  });
});
