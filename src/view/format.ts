import type { OemFile } from "../core";
import { formatTaiSeconds } from "../core/time";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatEpoch(file: OemFile, seconds: number, digits = 3): { text: string; dubious: boolean } | null {
  if (!file.origin) return null;
  try {
    return formatTaiSeconds(file.origin, seconds, digits);
  } catch {
    return null;
  }
}

/**
 * Width samples for the viewing clocks. Digits are 8, a wide figure, so the
 * reserved box stays put while the live text changes.
 * The readable sample uses the longest month name and a two-digit day.
 * The ISO sample matches `formatEpoch` at 3 decimal places.
 */
export const READABLE_UTC_WIDTH = "30 September 8888 UTC 88:88:88";
export const ISO_UTC_WIDTH = "8888-88-88T88:88:88.888";

/** Calendar reading of a UTC ISO epoch. Seconds stay whole; the ISO string keeps the fraction. */
export function readableUtc(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${Number(match[3])} ${month} ${match[1]} UTC ${match[4]}:${match[5]}:${match[6]}`;
}
