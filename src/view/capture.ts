/** Playback samples this many frames per realtime second. The trimmer uses the same step. */
export const EXPORT_FPS = 30;

/** One zip holds at most this many frames. */
export const EXPORT_FRAME_CAP = 100;

export const STILL_WIDTH = 3624;
export const STILL_HEIGHT = 2448;
export const SEQUENCE_WIDTH = 2560;
export const SEQUENCE_HEIGHT = 1440;

/** File-seconds between captured frames. Matches the player: each frame advances `speed / fps`. */
export function frameStep(speed: number): number {
  return speed / EXPORT_FPS;
}

/** Times from `start` through `end`, one step apart, never more than the cap. */
export function frameTimes(start: number, end: number, step: number, cap = EXPORT_FRAME_CAP): number[] {
  if (!(step > 0)) return [start];
  const last = Math.max(start, end);
  const count = Math.min(cap, Math.floor((last - start) / step + 1e-6) + 1);
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) times.push(start + index * step);
  return times;
}

/** End of a full window that begins at `start` and stays inside coverage. */
export function windowEnd(start: number, step: number, stop: number, cap = EXPORT_FRAME_CAP): number {
  const span = step * Math.max(0, cap - 1);
  return Math.min(stop, start + span);
}

/** The next window after `saved` frames, keeping the same length and stopping at coverage. */
export function nextWindow(
  start: number,
  end: number,
  step: number,
  stop: number,
  saved: number,
): { start: number; end: number } {
  const duration = Math.max(0, end - start);
  const nextStart = Math.min(stop, start + saved * step);
  const nextEnd = Math.min(stop, nextStart + duration);
  return { start: nextStart, end: nextEnd };
}

export function moveTrim(
  mode: "start" | "end" | "move",
  origin: number,
  time: number,
  start: number,
  end: number,
  coverageStart: number,
  coverageStop: number,
  maxSpan: number,
): { start: number; end: number } {
  if (mode === "move") {
    const span = Math.max(0, end - start);
    let nextStart = start + (time - origin);
    let nextEnd = nextStart + span;
    if (nextStart < coverageStart) {
      nextStart = coverageStart;
      nextEnd = nextStart + span;
    }
    if (nextEnd > coverageStop) {
      nextEnd = coverageStop;
      nextStart = Math.max(coverageStart, nextEnd - span);
    }
    return { start: nextStart, end: nextEnd };
  }
  if (mode === "start") {
    const minStart = Math.max(coverageStart, end - maxSpan);
    return { start: Math.min(end, Math.max(minStart, time)), end };
  }
  const maxEnd = Math.min(coverageStop, start + maxSpan);
  return { start, end: Math.max(start, Math.min(maxEnd, time)) };
}

export function stillName(iso: string | null): string {
  return `ephemeris-${stamp(iso, "frame")}.png`;
}

export function sequenceName(iso: string | null): string {
  return `ephemeris-${stamp(iso, "sequence")}.zip`;
}

export function frameFileName(index: number): string {
  return `frame-${String(index + 1).padStart(3, "0")}.png`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function stamp(iso: string | null, fallback: string): string {
  return (iso ?? fallback).replace(/[:.]/g, "-");
}
