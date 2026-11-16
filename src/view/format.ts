import type { OemFile } from "../core";
import { doyToMonthDay, formatTaiSeconds, parseUtcEpoch, taiSecondsBetween, type TaiOrigin } from "../core/time";

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

/**
 * Edit mask for the viewing clock. Fourteen digit slots sit inside
 * `YYYY-MM-DDThh:mm:ss`. The separators never move, and an empty slot keeps
 * its letter so the format stays on screen. `ISO_EDIT_WIDTH` is the same
 * shape in the wide digit, used only to reserve the field width.
 */
export const ISO_EDIT_MASK = "YYYY-MM-DDThh:mm:ss";
export const ISO_EDIT_WIDTH = "8888-88-88T88:88:88";

const ISO_SLOTS = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] as const;

export type IsoEdit = { text: string; caret: number };

const CAL_STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/;
const DOY_STAMP = /^(\d{4})-(\d{3})(?:T(\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/;
const TIME_STAMP = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The current clock text, or any pasted timestamp, drawn in the fixed mask. */
export function isoEditValue(text: string): string {
  const stamp = readStamp(text);
  if (stamp && stamp !== "invalid") return writeDigits(ISO_EDIT_MASK, stamp.digits, stamp.from).text;
  return paint(text.replace(/\D/g, ""));
}

/**
 * Put digits into the slots at the caret. A selection is cleared first.
 * Separators are skipped, and digits past the last slot are dropped.
 */
export function isoMaskType(text: string, start: number, end: number, incoming: string): IsoEdit {
  const digits = incoming.replace(/\D/g, "");
  const chars = maskChars(text);
  if (!digits) return { text: chars.join(""), caret: clampCaret(start) };
  if (start !== end) clearSlots(chars, start, end);
  let slot = slotAtOrAfter(start);
  let written: number | null = null;
  for (const digit of digits) {
    if (slot == null) break;
    chars[slot] = digit;
    written = slot;
    slot = slotAfter(slot);
  }
  const caret = written == null ? clampCaret(start) : isoMaskArrow(written, 1);
  return { text: chars.join(""), caret };
}

/** Remove the digit before the caret, or the digits in the selection. Separators stay. */
export function isoMaskBackspace(text: string, start: number, end: number): IsoEdit {
  const chars = maskChars(text);
  if (start !== end) {
    const caret = clearSlots(chars, start, end);
    return { text: chars.join(""), caret };
  }
  const slot = slotBefore(start);
  if (slot == null) return { text: chars.join(""), caret: 0 };
  chars[slot] = ISO_EDIT_MASK[slot];
  return { text: chars.join(""), caret: slot };
}

/** Remove the digit at the caret, or the digits in the selection. */
export function isoMaskDelete(text: string, start: number, end: number): IsoEdit {
  const chars = maskChars(text);
  if (start !== end) {
    const caret = clearSlots(chars, start, end);
    return { text: chars.join(""), caret };
  }
  const slot = slotAtOrAfter(start);
  if (slot == null) return { text: chars.join(""), caret: ISO_EDIT_MASK.length };
  chars[slot] = ISO_EDIT_MASK[slot];
  return { text: chars.join(""), caret: slot };
}

/**
 * A formatted timestamp replaces the fields it names. A fraction, a trailing
 * Z, a numeric offset, and a space in place of T are accepted. Digits with
 * no punctuation fill from the caret, like a card number.
 */
export function isoMaskPaste(text: string, start: number, end: number, incoming: string): IsoEdit {
  const current = maskChars(text).join("");
  const stamp = readStamp(incoming);
  if (stamp === "invalid") return { text: current, caret: clampCaret(start) };
  if (stamp) return writeDigits(current, stamp.digits, stamp.from);
  const digits = incoming.replace(/\D/g, "");
  if (!digits) return { text: current, caret: clampCaret(start) };
  if (/[^0-9\s]/.test(incoming)) return writeDigits(ISO_EDIT_MASK, digits, 0);
  return isoMaskType(current, start, end, digits);
}

/** Next caret that sits on a digit slot, skipping a separator. */
export function isoMaskArrow(caret: number, direction: -1 | 1): number {
  if (direction > 0) return slotAfter(caret) ?? ISO_EDIT_MASK.length;
  return slotBefore(caret) ?? 0;
}

/** A caret that landed on a separator moves to the following digit slot. */
export function isoMaskSnap(caret: number): number {
  if (caret <= 0) return 0;
  if (caret >= ISO_EDIT_MASK.length) return ISO_EDIT_MASK.length;
  if (isSlot(caret)) return caret;
  return slotAfter(caret - 1) ?? ISO_EDIT_MASK.length;
}

const MINUTE_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{3})T\d{2}:\d{2}$/;

/**
 * TAI seconds from `origin` for a UTC instant typed next to the ISO clock.
 * Accepts the displayed form, a trailing Z, a space instead of T, and a time with no seconds.
 */
export function utcTextToSeconds(origin: TaiOrigin, text: string): number {
  let value = text.trim();
  if (value.endsWith("Z") || value.endsWith("z")) value = value.slice(0, -1).trim();
  value = value.replace(/\s+/, "T");
  if (MINUTE_RE.test(value)) value += ":00";
  const parsed = parseUtcEpoch(value);
  return taiSecondsBetween(parsed.tai1, parsed.tai2, origin.tai1, origin.tai2);
}

/** Calendar reading of a UTC ISO epoch. Seconds stay whole; the ISO string keeps the fraction. */
export function readableUtc(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${Number(match[3])} ${month} ${match[1]} UTC ${match[4]}:${match[5]}:${match[6]}`;
}

type Stamp = { digits: string; from: number };

function readStamp(text: string): Stamp | "invalid" | null {
  const value = stampBody(text);
  if (!value) return null;
  const time = TIME_STAMP.exec(value);
  if (time) return { digits: time[1] + time[2] + (time[3] ?? "00"), from: 8 };
  const cal = CAL_STAMP.exec(value);
  if (cal) {
    const second = cal[6] ?? (cal[5] != null ? "00" : "");
    return { digits: cal[1] + cal[2] + cal[3] + (cal[4] ?? "") + (cal[5] ?? "") + second, from: 0 };
  }
  const doy = DOY_STAMP.exec(value);
  if (!doy) return null;
  let month = 0;
  let day = 0;
  try {
    const parts = doyToMonthDay(Number(doy[1]), Number(doy[2]));
    month = parts.month;
    day = parts.day;
  } catch {
    return "invalid";
  }
  const second = doy[5] ?? (doy[4] != null ? "00" : "");
  return {
    digits: doy[1] + String(month).padStart(2, "0") + String(day).padStart(2, "0") + (doy[3] ?? "") + (doy[4] ?? "") + second,
    from: 0,
  };
}

function stampBody(text: string): string | null {
  let value = text.trim();
  if (!value) return null;
  if (/[Zz]$/.test(value)) value = value.slice(0, -1).trim();
  value = value.replace(/\s+/, "T");
  value = value.replace(/t/g, "T");
  value = value.replace(/\.\d+/, "");
  value = value.replace(/(?:[+-]\d{2}:?\d{2})$/, "");
  return value;
}

function paint(digits: string): string {
  return writeDigits(ISO_EDIT_MASK, digits, 0).text;
}

function writeDigits(text: string, digits: string, from: number): IsoEdit {
  const chars = maskChars(text);
  const count = Math.max(0, Math.min(digits.length, ISO_SLOTS.length - from));
  if (count === 0) return { text: chars.join(""), caret: clampCaret(from === 0 ? 0 : ISO_SLOTS[from - 1] + 1) };
  for (let i = 0; i < count; i += 1) chars[ISO_SLOTS[from + i]] = digits[i];
  return { text: chars.join(""), caret: isoMaskArrow(ISO_SLOTS[from + count - 1], 1) };
}

function maskChars(text: string): string[] {
  const chars = ISO_EDIT_MASK.split("");
  if (text.length !== ISO_EDIT_MASK.length) return chars;
  for (const slot of ISO_SLOTS) {
    const ch = text[slot];
    if (ch >= "0" && ch <= "9") chars[slot] = ch;
  }
  return chars;
}

function clearSlots(chars: string[], start: number, end: number): number {
  let first: number | null = null;
  for (const slot of ISO_SLOTS) {
    if (slot < start || slot >= end) continue;
    chars[slot] = ISO_EDIT_MASK[slot];
    if (first == null) first = slot;
  }
  return first ?? isoMaskSnap(start);
}

function slotAtOrAfter(index: number): number | null {
  for (const slot of ISO_SLOTS) if (slot >= index) return slot;
  return null;
}

function slotBefore(index: number): number | null {
  let found: number | null = null;
  for (const slot of ISO_SLOTS) {
    if (slot < index) found = slot;
    else break;
  }
  return found;
}

function slotAfter(index: number): number | null {
  for (const slot of ISO_SLOTS) if (slot > index) return slot;
  return null;
}

function isSlot(index: number): boolean {
  return ISO_SLOTS.some((slot) => slot === index);
}

function clampCaret(caret: number): number {
  if (!Number.isFinite(caret) || caret <= 0) return 0;
  if (caret >= ISO_EDIT_MASK.length) return ISO_EDIT_MASK.length;
  return caret;
}
