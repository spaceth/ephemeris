/**
 * The welcome “Explore” scene. No spacecraft file: the Sun is the origin,
 * and the catalog places Mercury through Pluto from the DE440 cut.
 * The clock runs 1972-01-01 through 2050-01-01 UTC, inside that cut
 * and after the leap-second table begins.
 */

import type { OemFile } from "../core";
import { parseUtcEpoch, secondsAtUtcDate, taiSecondsBetween } from "../core/time";

const START = parseUtcEpoch("1972-01-01T00:00:00");
const STOP = parseUtcEpoch("2050-01-01T00:00:00");

export const SOLAR_ORIGIN = { tai1: START.tai1, tai2: START.tai2 };

export const SOLAR_SPAN = {
  start: 0,
  stop: taiSecondsBetween(STOP.tai1, STOP.tai2, START.tai1, START.tai2),
};

/** Stable token so the welcome gate opens once, not on every render. */
export const SOLAR_VIEW = { kind: "solar" } as const;

/**
 * Overview distance in scene kilometers. The camera sits about 1.56 times
 * this from the origin at a 42° field, which frames a little past 50 AU.
 */
const AU_KM = 149597870.7;
export const SOLAR_OVERVIEW_KM = 90 * AU_KM;

/** Empty file so the viewing clock can format epochs. It is not an uploaded ephemeris. */
export const SOLAR_FILE: OemFile = {
  version: "",
  creationDate: null,
  originator: null,
  messageId: null,
  comments: [],
  segments: [],
  covariances: [],
  warnings: [],
  origin: SOLAR_ORIGIN,
  format: "kvn",
};

/** File-relative seconds of a UTC instant, or null when it falls outside the solar window. */
export function solarSeconds(date: Date): number | null {
  let seconds: number;
  try {
    seconds = secondsAtUtcDate(SOLAR_ORIGIN, date);
  } catch {
    return null;
  }
  if (seconds < SOLAR_SPAN.start || seconds > SOLAR_SPAN.stop) return null;
  return seconds;
}
