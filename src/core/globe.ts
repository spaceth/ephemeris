/**
 * Earth attitude and the Sun, both in EME2000.
 *
 * The crust orientation is the IAU 1976 precession (Lieske) from the mean
 * equator of date back to J2000.0, times the IAU 1982 Greenwich mean
 * sidereal time. At J2000.0 the precession is the identity, so the result
 * is the mean equator and equinox of J2000.0 rather than the GCRS.
 * UT1 is taken as UTC. Polar motion, DUT1, and nutation are left out:
 * together they move the surface by well under one pixel of the Earth map.
 *
 * The Sun is a low-precision geocentric direction in the mean equator of
 * date, precessed back to EME2000. It is accurate to about 0.01°, which
 * is enough to place the day/night terminator.
 */

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

/** ITRF column vector into EME2000. Ignores polar motion. */
export function earthEmeFromItrf(jdUt1: number, jdTt: number): Mat3 {
  const spin = r3(-gmst(jdUt1));
  return mul(transpose(precessionJ2000ToDate(jdTt)), spin);
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

/** Sun direction in scene axes, unit length. */
export function sunScene(jdTt: number): [number, number, number] {
  const [x, y, z] = sunEme2000(jdTt);
  return [x, z, -y];
}

/** UT1 (as UTC) and TT Julian dates for a TAI offset from the file origin. */
export function earthEpochs(origin: TaiOrigin, taiSeconds: number): { jdUt1: number; jdTt: number } {
  const tai = taiFromSeconds(origin, taiSeconds);
  const utc = taiutc(tai.tai1, tai.tai2);
  return {
    jdUt1: utc.utc1 + utc.utc2,
    jdTt: tai.tai1 + tai.tai2 + TT_MINUS_TAI / DAYSEC,
  };
}
