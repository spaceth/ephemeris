/**
 * TT and the isolated TDB approximation used before SPK evaluation.
 * Replace `tdbSecondsPastJ2000` to adopt a TDB−TT series. Callers must
 * keep the returned quality on the state. The number is not native TDB.
 */

import { DAYSEC, type TaiOrigin, taiFromSeconds } from "../time";
import type { StateQuality } from "./state";

/** TT − TAI, seconds. Constant. */
export const TT_MINUS_TAI_SECONDS = 32.184;

/** Julian Date of 2000-01-01 12:00 on the scale in use. SPICE epoch J2000 is this instant of TDB. */
export const J2000_JD = 2451545.0;

export type TdbConversion = {
  /** TDB seconds past J2000, under the approximation named in `quality`. */
  secondsPastJ2000: number;
  quality: Extract<StateQuality, { kind: "approximate" }>;
};

/**
 * TAI Julian Date to TDB seconds past J2000.
 * TT = TAI + 32.184 s, and TDB is taken equal to TT.
 */
export function tdbSecondsPastJ2000(tai1: number, tai2: number): TdbConversion {
  const secondsTai = (tai1 - J2000_JD) * DAYSEC + tai2 * DAYSEC;
  return {
    secondsPastJ2000: secondsTai + TT_MINUS_TAI_SECONDS,
    quality: { kind: "approximate", reason: "tdb-equals-tt" },
  };
}

/** File-relative TAI seconds from `origin` to TDB seconds past J2000. */
export function tdbFromTaiClock(origin: TaiOrigin, taiSeconds: number): TdbConversion {
  const tai = taiFromSeconds(origin, taiSeconds);
  return tdbSecondsPastJ2000(tai.tai1, tai.tai2);
}
