/**
 * UTC and TAI following ERFA's leap-second conventions
 * (eraDat, eraDtf2d, eraUtctai, eraTaiutc, eraD2dtf).
 * JavaScript Date is not used as the scientific epoch.
 *
 * Leap seconds: IERS leap-seconds.list retrieved 2026-11-11.
 * The file expires 2027-06-28. TAI−UTC = 37 s from 2017-01-01.
 * No leap second is recorded after that date. Instants after the expiry
 * still use 37 s and are flagged dubious.
 */

export const DAYSEC = 86400;
export const DJM0 = 2400000.5;
export const DBL_EPSILON = 2.2204460492503131e-16;

export const LEAP_SOURCE =
  "IERS leap-seconds.list (Bulletin C), retrieved 2026-11-11, expires 2027-06-28. TAI−UTC = 37 s since 2017-01-01.";
export const LEAP_EXPIRES = { year: 2027, month: 6, day: 28 };

/** TAI−UTC beginning at 0h UTC on the given year and month. */
const LEAPS: ReadonlyArray<readonly [number, number, number]> = [
  [1972, 1, 10],
  [1972, 7, 11],
  [1973, 1, 12],
  [1974, 1, 13],
  [1975, 1, 14],
  [1976, 1, 15],
  [1977, 1, 16],
  [1978, 1, 17],
  [1979, 1, 18],
  [1980, 1, 19],
  [1981, 7, 20],
  [1982, 7, 21],
  [1983, 7, 22],
  [1985, 7, 23],
  [1988, 1, 24],
  [1990, 1, 25],
  [1991, 1, 26],
  [1992, 7, 27],
  [1993, 7, 28],
  [1994, 7, 29],
  [1996, 1, 30],
  [1997, 7, 31],
  [1999, 1, 32],
  [2006, 1, 33],
  [2009, 1, 34],
  [2012, 7, 35],
  [2015, 7, 36],
  [2017, 1, 37],
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export class TimeScaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeScaleError";
  }
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function compareYmd(
  ay: number,
  am: number,
  ad: number,
  by: number,
  bm: number,
  bd: number,
): number {
  if (ay !== by) return ay - by;
  if (am !== bm) return am - bm;
  return ad - bd;
}

function assertCalendar(year: number, month: number, day: number): void {
  if (!Number.isInteger(year) || year < -4799) {
    throw new TimeScaleError(`Invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new TimeScaleError(`Invalid month ${month}`);
  }
  const dim = MONTH_DAYS[month - 1] + (month === 2 && isLeapYear(year) ? 1 : 0);
  if (!Number.isInteger(day) || day < 1 || day > dim) {
    throw new TimeScaleError(`Invalid day ${year}-${month}-${day}`);
  }
}

export function doyToMonthDay(year: number, doy: number): { month: number; day: number } {
  if (!Number.isInteger(year) || !Number.isInteger(doy)) {
    throw new TimeScaleError("Day-of-year must be an integer");
  }
  const leap = isLeapYear(year);
  const limit = leap ? 366 : 365;
  if (doy < 1 || doy > limit) {
    throw new TimeScaleError(`Day-of-year ${doy} is outside 1..${limit} for ${year}`);
  }
  let rest = doy;
  for (let month = 1; month <= 12; month += 1) {
    const dim = MONTH_DAYS[month - 1] + (month === 2 && leap ? 1 : 0);
    if (rest <= dim) return { month, day: rest };
    rest -= dim;
  }
  throw new TimeScaleError(`Day-of-year ${doy} is invalid`);
}

/** Gregorian calendar to Julian Date, ERFA eraCal2jd. */
export function cal2jd(year: number, month: number, day: number): { djm0: number; djm: number } {
  assertCalendar(year, month, day);
  const my = Math.trunc((month - 14) / 12);
  const iypmy = year + my;
  const djm =
    Math.trunc((1461 * (iypmy + 4800)) / 4) +
    Math.trunc((367 * (month - 2 - 12 * my)) / 12) -
    Math.trunc((3 * Math.trunc((iypmy + 4900) / 100)) / 4) +
    day -
    2432076;
  return { djm0: DJM0, djm };
}

function dnint(a: number): number {
  if (Math.abs(a) < 0.5) return 0;
  return a < 0 ? Math.ceil(a - 0.5) : Math.floor(a + 0.5);
}

/** Julian Date to Gregorian calendar, ERFA eraJd2cal. */
export function jd2cal(dj1: number, dj2: number): { year: number; month: number; day: number; fd: number } {
  const dj = dj1 + dj2;
  if (dj < -68569.5 || dj > 1e9) throw new TimeScaleError("Julian date is out of range");
  let d = dnint(dj1);
  const f1 = dj1 - d;
  let jd = d;
  d = dnint(dj2);
  const f2 = dj2 - d;
  jd += d;

  let s = 0.5;
  let cs = 0;
  for (const x of [f1, f2]) {
    const t = s + x;
    cs += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
    if (s >= 1) {
      jd += 1;
      s -= 1;
    }
  }
  let f = s + cs;
  cs = f - s;
  if (f < 0) {
    f = s + 1;
    cs += 1 - f + s;
    s = f;
    f = s + cs;
    cs = f - s;
    jd -= 1;
  }
  if (f - 1 >= -DBL_EPSILON / 4) {
    const t = s - 1;
    cs += s - t - 1;
    s = t;
    f = s + cs;
    if (-DBL_EPSILON / 2 < f) {
      jd += 1;
      f = Math.max(f, 0);
    }
  }

  let l = jd + 68569;
  const n = Math.trunc((4 * l) / 146097);
  l -= Math.trunc((146097 * n + 3) / 4);
  const i = Math.trunc((4000 * (l + 1)) / 1461001);
  l -= Math.trunc((1461 * i) / 4) - 31;
  const k = Math.trunc((80 * l) / 2447);
  const day = l - Math.trunc((2447 * k) / 80);
  l = Math.trunc(k / 11);
  const month = k + 2 - 12 * l;
  const year = 100 * (n - 49) + i + l;
  return { year, month, day, fd: f };
}

/** TAI−UTC in seconds at a UTC calendar date. The fraction of the day is not used after 1972. */
export function dat(
  year: number,
  month: number,
  day: number,
): { seconds: number; dubious: boolean } {
  assertCalendar(year, month, day);
  if (year < 1972) {
    throw new TimeScaleError("UTC before 1972-01-01 is outside the bundled leap-second table");
  }
  const key = 12 * year + month;
  let seconds = -1;
  for (const [y, m, value] of LEAPS) {
    if (key >= 12 * y + m) seconds = value;
  }
  if (seconds < 0) {
    throw new TimeScaleError("UTC date is before the first tabulated leap second");
  }
  const dubious = compareYmd(year, month, day, LEAP_EXPIRES.year, LEAP_EXPIRES.month, LEAP_EXPIRES.day) > 0;
  return { seconds, dubious };
}

function leapExcess(year: number, month: number, day: number): number {
  const dat0 = dat(year, month, day).seconds;
  const today = cal2jd(year, month, day);
  const tomorrow = jd2cal(today.djm0 + today.djm, 1.5);
  const dat24 = dat(tomorrow.year, tomorrow.month, tomorrow.day).seconds;
  return dat24 - dat0;
}

/**
 * Calendar fields to a UTC quasi-JD, ERFA eraDtf2d for scale "UTC".
 * On a leap-second day the day fraction uses the 86401 s UTC day.
 */
export function utcFieldsToJd(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): { utc1: number; utc2: number; dubious: boolean } {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new TimeScaleError(`Invalid hour ${hour}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new TimeScaleError(`Invalid minute ${minute}`);
  }
  if (!Number.isFinite(second) || second < 0) {
    throw new TimeScaleError(`Invalid second ${second}`);
  }
  const { djm0, djm } = cal2jd(year, month, day);
  const dleap = leapExcess(year, month, day);
  let seclim = 60;
  if (hour === 23 && minute === 59) seclim += dleap;
  if (second >= seclim) {
    throw new TimeScaleError(
      `Second ${second} is not a valid UTC second on ${year}-${month}-${day} (limit ${seclim})`,
    );
  }
  const dayLength = DAYSEC + dleap;
  const time = (60 * (60 * hour + minute) + second) / dayLength;
  const info = dat(year, month, day);
  return { utc1: djm0 + djm, utc2: time, dubious: info.dubious };
}

/** UTC quasi-JD to TAI Julian Date, ERFA eraUtctai. */
export function utctai(utc1: number, utc2: number): { tai1: number; tai2: number; dubious: boolean } {
  const big1 = Math.abs(utc1) >= Math.abs(utc2);
  const u1 = big1 ? utc1 : utc2;
  const u2 = big1 ? utc2 : utc1;
  const today = jd2cal(u1, u2);
  const dat0 = dat(today.year, today.month, today.day);
  const dat12 = dat(today.year, today.month, today.day);
  const tomorrow = jd2cal(u1 + 1.5, u2 - today.fd);
  const dat24 = dat(tomorrow.year, tomorrow.month, tomorrow.day);
  const dlod = 2 * (dat12.seconds - dat0.seconds);
  const dleap = dat24.seconds - (dat0.seconds + dlod);
  let fd = today.fd;
  fd *= (DAYSEC + dleap) / DAYSEC;
  fd *= (DAYSEC + dlod) / DAYSEC;
  const z = cal2jd(today.year, today.month, today.day);
  let a2 = z.djm0 - u1;
  a2 += z.djm;
  a2 += fd + dat0.seconds / DAYSEC;
  const dubious = dat0.dubious || dat24.dubious;
  if (big1) return { tai1: u1, tai2: a2, dubious };
  return { tai1: a2, tai2: u1, dubious };
}

/** TAI Julian Date to UTC quasi-JD, ERFA eraTaiutc. */
export function taiutc(tai1: number, tai2: number): { utc1: number; utc2: number; dubious: boolean } {
  const big1 = Math.abs(tai1) >= Math.abs(tai2);
  const a1 = big1 ? tai1 : tai2;
  const a2 = big1 ? tai2 : tai1;
  const u1 = a1;
  let u2 = a2;
  let dubious = false;
  for (let i = 0; i < 3; i += 1) {
    const back = utctai(u1, u2);
    dubious = back.dubious;
    u2 += a1 - back.tai1;
    u2 += a2 - back.tai2;
  }
  if (big1) return { utc1: u1, utc2: u2, dubious };
  return { utc1: u2, utc2: u1, dubious };
}

function d2tf(ndp: number, days: number): [number, number, number, number] {
  let a = DAYSEC * Math.abs(days);
  const nrsPow = 10 ** ndp;
  a = dnint(nrsPow * a);
  const rs = nrsPow;
  const rm = rs * 60;
  const rh = rm * 60;
  let ah = Math.trunc(a / rh);
  a -= ah * rh;
  let am = Math.trunc(a / rm);
  a -= am * rm;
  let as = Math.trunc(a / rs);
  const af = a - as * rs;
  if (!Number.isFinite(ah)) ah = 0;
  if (!Number.isFinite(am)) am = 0;
  if (!Number.isFinite(as)) as = 0;
  return [ah, am, as, af];
}

/** Format a UTC quasi-JD, ERFA eraD2dtf with the requested decimal places. */
export function formatUtcJd(utc1: number, utc2: number, ndp = 3): { text: string; dubious: boolean } {
  const cal = jd2cal(utc1, utc2);
  const dat0 = dat(cal.year, cal.month, cal.day);
  const tomorrow = jd2cal(utc1 + 1.5, utc2 - cal.fd);
  const dat24 = dat(tomorrow.year, tomorrow.month, tomorrow.day);
  const dleap = dat24.seconds - dat0.seconds;
  const leap = Math.abs(dleap) > 0.5;
  let fd = cal.fd;
  if (leap) fd += (fd * dleap) / DAYSEC;
  const fields = d2tf(ndp, fd);
  let hour = fields[0];
  let minute = fields[1];
  let second = fields[2];
  const frac = fields[3];
  let year = cal.year;
  let month = cal.month;
  let day = cal.day;
  if (hour > 23) {
    if (!leap || second > 0) {
      year = tomorrow.year;
      month = tomorrow.month;
      day = tomorrow.day;
      hour = 0;
      minute = 0;
      second = 0;
    } else {
      hour = 23;
      minute = 59;
      second = 60;
    }
  }
  const fracText = String(Math.trunc(frac)).padStart(ndp, "0");
  const text =
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` +
    `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}` +
    (ndp > 0 ? `.${fracText}` : "");
  return { text, dubious: dat0.dubious || dat24.dubious };
}

export type TaiOrigin = { tai1: number; tai2: number };

export function taiSecondsBetween(
  tai1: number,
  tai2: number,
  origin1: number,
  origin2: number,
): number {
  return ((tai1 - origin1) + (tai2 - origin2)) * DAYSEC;
}

export function taiFromSeconds(origin: TaiOrigin, seconds: number): { tai1: number; tai2: number } {
  return { tai1: origin.tai1, tai2: origin.tai2 + seconds / DAYSEC };
}

export type ParsedUtc = {
  text: string;
  utc1: number;
  utc2: number;
  tai1: number;
  tai2: number;
  dubious: boolean;
};

const CAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/;
const DOY_RE = /^(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/;

export function ccsdsEpochShape(text: string): "calendar" | "doy" | null {
  const trimmed = text.trim();
  if (DOY_RE.test(trimmed)) return "doy";
  if (CAL_RE.test(trimmed)) return "calendar";
  return null;
}

/** Parse a CCSDS calendar or day-of-year UTC epoch. The time scale is supplied by the caller. */
export function parseUtcEpoch(text: string): ParsedUtc {
  const trimmed = text.trim();
  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let second: number;
  const doy = DOY_RE.exec(trimmed);
  const cal = CAL_RE.exec(trimmed);
  if (doy) {
    year = Number(doy[1]);
    const md = doyToMonthDay(year, Number(doy[2]));
    month = md.month;
    day = md.day;
    hour = Number(doy[3]);
    minute = Number(doy[4]);
    second = Number(doy[5]);
  } else if (cal) {
    year = Number(cal[1]);
    month = Number(cal[2]);
    day = Number(cal[3]);
    hour = Number(cal[4]);
    minute = Number(cal[5]);
    second = Number(cal[6]);
  } else {
    throw new TimeScaleError(
      `Epoch "${trimmed}" is not a CCSDS calendar (YYYY-MM-DDThh:mm:ss) or day-of-year (YYYY-DDDThh:mm:ss) time`,
    );
  }
  const utc = utcFieldsToJd(year, month, day, hour, minute, second);
  const tai = utctai(utc.utc1, utc.utc2);
  return {
    text: trimmed,
    utc1: utc.utc1,
    utc2: utc.utc2,
    tai1: tai.tai1,
    tai2: tai.tai2,
    dubious: utc.dubious || tai.dubious,
  };
}

/**
 * UTC civil fields of a Date, placed on a TAI origin through the leap-second table.
 * The Date is only a source of UTC calendar fields, not the scientific epoch.
 */
export function secondsAtUtcDate(origin: TaiOrigin, date: Date): number {
  const second = date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
  const utc = utcFieldsToJd(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    second,
  );
  const tai = utctai(utc.utc1, utc.utc2);
  return taiSecondsBetween(tai.tai1, tai.tai2, origin.tai1, origin.tai2);
}

export function formatTaiSeconds(origin: TaiOrigin, seconds: number, ndp = 3): { text: string; dubious: boolean } {
  const tai = taiFromSeconds(origin, seconds);
  const utc = taiutc(tai.tai1, tai.tai2);
  return formatUtcJd(utc.utc1, utc.utc2, ndp);
}
