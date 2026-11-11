/**
 * Earth attitude and the Sun, both in EME2000.
 *
 * The crust uses the equinox path in `orientation.ts`: IAU 2006 precession,
 * IAU 2000B nutation, and the Greenwich sidereal angle. UT1 is the file's
 * UTC, so that status is approximate. Polar motion is unavailable without a
 * bulletin and is not replaced by zero. `gmst` below is the older IAU 1982
 * series and is not the crust rotation.
 *
 * The Moon keeps the IAU libration series in this file. That series is its
 * own model, not a planetary constants kernel.
 *
 * The Sun fallback is a low-precision geocentric direction in the mean
 * equator of date, precessed back to EME2000. It is accurate to about 0.01°,
 * which is enough to place the day/night terminator until the snapshot loads.
 */

import { earthAttitude } from "./ephemeris/orientation";
import type { EopStatus } from "./ephemeris/orientation";
import { DAYSEC, taiFromSeconds, taiutc, type TaiOrigin } from "./time";

const J2000 = 2451545.0;
const JULIAN_CENTURY = 36525;
const TT_MINUS_TAI = 32.184;
const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;

/** Row-major 3×3. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

type Vec3 = readonly [number, number, number];

/** Scene axes from EME2000: (x, y, z) → (x, z, −y). Row-major, no scale. */
const EME_TO_SCENE: Mat3 = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const SCENE_TO_EME: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];

function wrapTau(angle: number): number {
  const tau = Math.PI * 2;
  const wrapped = angle % tau;
  return wrapped < 0 ? wrapped + tau : wrapped;
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out.push(
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col],
      );
    }
  }
  return out as unknown as Mat3;
}

function apply(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** SOFA r-matrix for a positive rotation of the frame about Z. */
function r3(psi: number): Mat3 {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

/** SOFA r-matrix for a positive rotation of the frame about Y. */
function r2(theta: number): Mat3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

/**
 * Greenwich mean sidereal time, radians, IAU 1982.
 * The Julian date is UT1. This profile uses UTC in its place.
 */
export function gmst(jdUt1: number): number {
  const whole = Math.floor(jdUt1);
  const frac = jdUt1 - whole;
  const centuries = (frac + (whole - J2000)) / JULIAN_CENTURY;
  const seconds =
    24110.54841 -
    DAYSEC / 2 +
    (8640184.812866 + (0.093104 - 6.2e-6 * centuries) * centuries) * centuries +
    DAYSEC * frac;
  return wrapTau((seconds / DAYSEC) * Math.PI * 2);
}

/** IAU 1976 precession, J2000.0 → mean equator of date. v_date = P · v_J2000. */
function precessionJ2000ToDate(jdTt: number): Mat3 {
  const t = (jdTt - J2000) / JULIAN_CENTURY;
  const zeta = (2306.2181 + (0.30188 + 0.017998 * t) * t) * t * ARCSEC;
  const z = (2306.2181 + (1.09468 + 0.018203 * t) * t) * t * ARCSEC;
  const theta = (2004.3109 + (-0.42665 - 0.041833 * t) * t) * t * ARCSEC;
  return mul(mul(r3(-z), r2(theta)), r3(-zeta));
}

/** ITRF column vector into EME2000. Polar motion is omitted; see `earthAttitude`. */
export function earthEmeFromItrf(jdUt1: number, jdTt: number): Mat3 {
  return earthAttitude(jdUt1, jdTt).itrfToEme2000;
}

/**
 * The same rotation in scene axes, row-major, so a mesh matrix can be filled
 * directly. The sphere's local +X is the prime meridian and its local +Y is
 * the north pole, which already matches an equirectangular map.
 */
export function earthScene(jdUt1: number, jdTt: number): Mat3 {
  return mul(mul(EME_TO_SCENE, earthEmeFromItrf(jdUt1, jdTt)), SCENE_TO_EME);
}

/** Unit vector from the Earth toward the Sun, EME2000. */
export function sunEme2000(jdTt: number): [number, number, number] {
  const t = (jdTt - J2000) / JULIAN_CENTURY;
  const meanLon = 280.46646 + (36000.76983 + 0.0003032 * t) * t;
  const anomaly = (357.52911 + (35999.05029 - 0.0001537 * t) * t) * DEG;
  const center =
    (1.914602 - (0.004817 + 0.000014 * t) * t) * Math.sin(anomaly) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * anomaly) +
    0.000289 * Math.sin(3 * anomaly);
  const lon = (meanLon + center - 0.00569) * DEG;
  const eps = (23.4392911 - (0.0130042 + (1.64e-7 - 5.04e-7 * t) * t) * t) * DEG;
  const ofDate: [number, number, number] = [
    Math.cos(lon),
    Math.cos(eps) * Math.sin(lon),
    Math.sin(eps) * Math.sin(lon),
  ];
  const eme = apply(transpose(precessionJ2000ToDate(jdTt)), ofDate);
  const scale = Math.hypot(eme[0], eme[1], eme[2]);
  return [eme[0] / scale, eme[1] / scale, eme[2] / scale];
}

/** SOFA r-matrix for a positive rotation of the frame about X. */
function r1(phi: number): Mat3 {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/**
 * IAU north pole and prime meridian of the Moon, in EME2000.
 * The series is the IAU working-group model: the secular pole plus the
 * libration terms in E1–E13. It is not a PCK. d is days and T is centuries from J2000.0 TT.
 * The returned matrix sends the body frame (X prime meridian, Y east, Z north)
 * into EME2000.
 */
export function moonEmeFromBody(jdTt: number): Mat3 {
  const d = jdTt - J2000;
  const t = d / JULIAN_CENTURY;
  const arg = (deg: number, rate: number) => (deg + rate * d) * DEG;
  const e1 = arg(125.045, -0.0529921);
  const e2 = arg(250.089, -0.1059842);
  const e3 = arg(260.008, 13.0120009);
  const e4 = arg(176.625, 13.3407154);
  const e5 = arg(357.529, 0.9856003);
  const e6 = arg(311.589, 26.4057084);
  const e7 = arg(134.963, 13.064993);
  const e8 = arg(276.617, 0.3287146);
  const e9 = arg(34.226, 1.7484877);
  const e10 = arg(15.134, -0.1589763);
  const e11 = arg(119.743, 0.0036096);
  const e12 = arg(239.961, 0.1643573);
  const e13 = arg(25.053, 12.9590088);
  const alpha =
    (269.9949 +
      0.0031 * t -
      3.8787 * Math.sin(e1) -
      0.1204 * Math.sin(e2) +
      0.07 * Math.sin(e3) -
      0.0172 * Math.sin(e4) +
      0.0072 * Math.sin(e6) -
      0.0052 * Math.sin(e10) +
      0.0043 * Math.sin(e13)) *
    DEG;
  const delta =
    (66.5392 +
      0.013 * t +
      1.5419 * Math.cos(e1) +
      0.0239 * Math.cos(e2) -
      0.0278 * Math.cos(e3) +
      0.0068 * Math.cos(e4) -
      0.0029 * Math.cos(e6) +
      0.0009 * Math.cos(e7) +
      0.0008 * Math.cos(e10) -
      0.0009 * Math.cos(e13)) *
    DEG;
  const prime =
    (38.3213 +
      13.17635815 * d -
      1.4e-12 * d * d +
      3.561 * Math.sin(e1) +
      0.1208 * Math.sin(e2) -
      0.0642 * Math.sin(e3) +
      0.0158 * Math.sin(e4) +
      0.0252 * Math.sin(e5) -
      0.0066 * Math.sin(e6) -
      0.0047 * Math.sin(e7) -
      0.0046 * Math.sin(e8) +
      0.0028 * Math.sin(e9) +
      0.0052 * Math.sin(e10) +
      0.004 * Math.sin(e11) +
      0.0019 * Math.sin(e12) -
      0.0044 * Math.sin(e13)) *
    DEG;
  const toBody = mul(mul(r3(prime), r1(Math.PI / 2 - delta)), r3(Math.PI / 2 + alpha));
  return transpose(toBody);
}

/** Moon attitude in scene axes. Local +X is 0° longitude and local +Y is north. */
export function moonScene(jdTt: number): Mat3 {
  return mul(mul(EME_TO_SCENE, moonEmeFromBody(jdTt)), SCENE_TO_EME);
}

/** Sun direction in scene axes, unit length. */
export function sunScene(jdTt: number): [number, number, number] {
  const [x, y, z] = sunEme2000(jdTt);
  return [x, z, -y];
}

/**
 * UT1 stand-in (the file UTC) and TT for a TAI offset from the file origin.
 * `ut1` is approximate because no bulletin supplies UT1−UTC. Polar motion is unavailable.
 */
export function earthEpochs(origin: TaiOrigin, taiSeconds: number): {
  jdUt1: number;
  jdTt: number;
  ut1: EopStatus;
  polarMotion: EopStatus;
} {
  const tai = taiFromSeconds(origin, taiSeconds);
  const utc = taiutc(tai.tai1, tai.tai2);
  return {
    jdUt1: utc.utc1 + utc.utc2,
    jdTt: tai.tai1 + tai.tai2 + TT_MINUS_TAI / DAYSEC,
    ut1: "approximate",
    polarMotion: "unavailable",
  };
}
