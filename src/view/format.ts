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

/** Calendar reading of a UTC ISO epoch. Seconds stay whole; the ISO string keeps the fraction. */
export function readableUtc(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${Number(match[3])} ${month} ${match[1]} UTC ${match[4]}:${match[5]}:${match[6]}`;
}
