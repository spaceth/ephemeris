/**
 * Equinox-based Earth orientation.
 * IAU 2006 precession (Fukushima-Williams), IAU 2000B nutation, and the
 * Greenwich sidereal angle (GMST plus the equation of the equinoxes).
 * The crust rotation is that sidereal angle. It is not the Earth rotation
 * angle, and the CIO locator is not used.
 *
 * No Earth-orientation bulletin is loaded. UT1 is the caller's UTC, so that
 * part is approximate. Polar motion is omitted and reported unavailable
 * rather than filled with zeros. A supplied sample is applied only for that
 * epoch; it does not invent a 1950–2050 series.
 */

import { GCRS_TO_EME2000 } from "../frames";
import type { Mat3 } from "../globe";
import { NUTATION_2000B } from "./nutation2000b";

export type EopStatus = "observed" | "predicted" | "approximate" | "unavailable";

export type PolarMotion = { xpRad: number; ypRad: number };

export type EarthAttitude = {
  /** Column vectors: ITRF to EME2000. */
  itrfToEme2000: Mat3;
  ut1: EopStatus;
  polarMotion: EopStatus;
  /** No bulletin is bundled. Coverage stays empty until one is loaded. */
  bulletin: null;
  nutationRad: { dpsi: number; deps: number };
  greenwichSiderealRad: number;
};

const J2000 = 2451545.0;
const JC = 36525;
const DAS2R = Math.PI / (180 * 3600);
const TURNAS = 1296000;
const U2R = DAS2R / 1e7;
const DPPLAN = -0.135 * DAS2R / 1000;
const DEPLAN = 0.388 * DAS2R / 1000;

/** Order t^0 complementary terms, then the single order t^1 term. Arcseconds. */
const EECT: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 1, 0, 0, 0, 2640.96e-6, -0.39e-6],
  [0, 0, 0, 0, 2, 0, 0, 0, 63.52e-6, -0.02e-6],
  [0, 0, 2, -2, 3, 0, 0, 0, 11.75e-6, 0.01e-6],
  [0, 0, 2, -2, 1, 0, 0, 0, 11.21e-6, 0.01e-6],
  [0, 0, 2, -2, 2, 0, 0, 0, -4.55e-6, 0],
  [0, 0, 2, 0, 3, 0, 0, 0, 2.02e-6, 0],
  [0, 0, 2, 0, 1, 0, 0, 0, 1.98e-6, 0],
  [0, 0, 0, 0, 3, 0, 0, 0, -1.72e-6, 0],
  [0, 1, 0, 0, 1, 0, 0, 0, -1.41e-6, -0.01e-6],
  [0, 1, 0, 0, -1, 0, 0, 0, -1.26e-6, -0.01e-6],
  [1, 0, 0, 0, -1, 0, 0, 0, -0.63e-6, 0],
  [1, 0, 0, 0, 1, 0, 0, 0, -0.63e-6, 0],
  [0, 1, 2, -2, 3, 0, 0, 0, 0.46e-6, 0],
  [0, 1, 2, -2, 1, 0, 0, 0, 0.45e-6, 0],
  [0, 0, 4, -4, 4, 0, 0, 0, 0.36e-6, 0],
  [0, 0, 1, -1, 1, -8, 12, 0, -0.24e-6, -0.12e-6],
  [0, 0, 2, 0, 0, 0, 0, 0, 0.32e-6, 0],
  [0, 0, 2, 0, 2, 0, 0, 0, 0.28e-6, 0],
  [1, 0, 2, 0, 3, 0, 0, 0, 0.27e-6, 0],
  [1, 0, 2, 0, 1, 0, 0, 0, 0.26e-6, 0],
  [0, 0, 2, -2, 0, 0, 0, 0, -0.21e-6, 0],
  [0, 1, -2, 2, -3, 0, 0, 0, 0.19e-6, 0],
  [0, 1, -2, 2, -1, 0, 0, 0, 0.18e-6, 0],
  [0, 0, 0, 0, 0, 8, -13, -1, -0.1e-6, 0.05e-6],
  [0, 0, 0, 2, 0, 0, 0, 0, 0.15e-6, 0],
  [2, 0, -2, 0, -1, 0, 0, 0, -0.14e-6, 0],
  [1, 0, 0, -2, 1, 0, 0, 0, 0.14e-6, 0],
  [0, 1, 2, -2, 2, 0, 0, 0, -0.14e-6, 0],
  [1, 0, 0, -2, -1, 0, 0, 0, 0.14e-6, 0],
  [0, 0, 4, -2, 4, 0, 0, 0, 0.13e-6, 0],
  [0, 0, 2, -2, 4, 0, 0, 0, -0.11e-6, 0],
  [1, 0, -2, 0, -3, 0, 0, 0, 0.11e-6, 0],
  [1, 0, -2, 0, -1, 0, 0, 0, 0.11e-6, 0],
];
const EECT_T = [0, 0, 0, 0, 1, 0, 0, 0, -0.87e-6, 0];

function anp(angle: number): number {
  const tau = Math.PI * 2;
  const wrapped = angle % tau;
  return wrapped < 0 ? wrapped + tau : wrapped;
}

function wrapTurn(arcsec: number): number {
  const wrapped = arcsec % TURNAS;
  return (wrapped < 0 ? wrapped + TURNAS : wrapped) * DAS2R;
}

function poly(t: number, coefficients: readonly number[]): number {
  let value = 0;
  for (let i = coefficients.length - 1; i >= 0; i -= 1) value = value * t + coefficients[i];
  return value;
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out.push(a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]);
    }
  }
  return out as unknown as Mat3;
}

function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function r1(phi: number): Mat3 {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

function r2(theta: number): Mat3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

function r3(psi: number): Mat3 {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

function split(jd: number): [number, number] {
  const whole = Math.floor(jd);
  return [whole, jd - whole];
}

/** Mean obliquity, IAU 2006, radians. */
export function meanObliquity2006(jdTt: number): number {
  const t = (jdTt - J2000) / JC;
  return poly(t, [84381.406, -46.836769, -0.0001831, 0.0020034, -0.000000576, -0.0000000434]) * DAS2R;
}

function fukushimaWilliams(jdTt: number): { gamb: number; phib: number; psib: number; epsa: number } {
  const t = (jdTt - J2000) / JC;
  return {
    gamb: poly(t, [-0.052928, 10.556378, 0.4932044, -0.00031238, -0.000002788, 0.000000026]) * DAS2R,
    phib: poly(t, [84381.412819, -46.811016, 0.0511268, 0.00053289, -0.00000044, -0.0000000176]) * DAS2R,
    psib: poly(t, [-0.041775, 5038.481484, 1.5584175, -0.00018522, -0.000026452, -0.0000000148]) * DAS2R,
    epsa: meanObliquity2006(jdTt),
  };
}

/** IAU 2000B nutation in longitude and obliquity, radians. */
export function nutation2000b(jdTt: number): { dpsi: number; deps: number } {
  const t = (jdTt - J2000) / JC;
  const el = wrapTurn(poly(t, [485868.249036, 1717915923.2178]));
  const elp = wrapTurn(poly(t, [1287104.79305, 129596581.0481]));
  const f = wrapTurn(poly(t, [335779.526232, 1739527262.8478]));
  const d = wrapTurn(poly(t, [1072260.70369, 1602961601.209]));
  const om = wrapTurn(poly(t, [450160.398036, -6962890.5431]));
  let dp = 0;
  let de = 0;
  for (let i = NUTATION_2000B.length - 1; i >= 0; i -= 1) {
    const term = NUTATION_2000B[i];
    const arg = anp(term[0] * el + term[1] * elp + term[2] * f + term[3] * d + term[4] * om);
    const sarg = Math.sin(arg);
    const carg = Math.cos(arg);
    dp += (term[5] + term[6] * t) * sarg + term[7] * carg;
    de += (term[8] + term[9] * t) * carg + term[10] * sarg;
  }
  return { dpsi: dp * U2R + DPPLAN, deps: de * U2R + DEPLAN };
}

function delaunay2003(t: number): number[] {
  return [
    wrapTurn(poly(t, [485868.249036, 1717915923.2178, 31.8792, 0.051635, -0.0002447])),
    wrapTurn(poly(t, [1287104.793048, 129596581.0481, -0.5532, 0.000136, -0.00001149])),
    wrapTurn(poly(t, [335779.526232, 1739527262.8478, -12.7512, -0.001037, 0.00000417])),
    wrapTurn(poly(t, [1072260.703692, 1602961601.209, -6.3706, 0.006593, -0.00003169])),
    wrapTurn(poly(t, [450160.398036, -6962890.5431, 7.4722, 0.007702, -0.00005939])),
    anp(3.176146697 + 1021.3285546211 * t),
    anp(1.753470314 + 628.3075849991 * t),
    (0.02438175 + 0.00000538691 * t) * t,
  ];
}

function complementaryEquinox(jdTt: number): number {
  const t = (jdTt - J2000) / JC;
  const fa = delaunay2003(t);
  let s0 = 0;
  for (let i = EECT.length - 1; i >= 0; i -= 1) {
    const term = EECT[i];
    let arg = 0;
    for (let j = 0; j < 8; j += 1) arg += term[j] * fa[j];
    s0 += term[8] * Math.sin(arg) + term[9] * Math.cos(arg);
  }
  let arg = 0;
  for (let j = 0; j < 8; j += 1) arg += EECT_T[j] * fa[j];
  const s1 = EECT_T[8] * Math.sin(arg) + EECT_T[9] * Math.cos(arg);
  return (s0 + s1 * t) * DAS2R;
}

/**
 * Greenwich mean sidereal time, IAU 2006, radians.
 * The published series is ERA plus a precession polynomial. The value returned
 * is sidereal time. Callers that orient the crust add the equation of the equinoxes.
 */
export function gmst2006(jdUt1: number, jdTt: number): number {
  const [uta, utb] = split(jdUt1);
  const [tta, ttb] = split(jdTt);
  const d1 = uta < utb ? uta : utb;
  const d2 = uta < utb ? utb : uta;
  const day = d1 + (d2 - J2000);
  const fraction = (d1 % 1) + (d2 % 1);
  const era = anp(Math.PI * 2 * (fraction + 0.7790572732640 + 0.00273781191135448 * day));
  const t = ((tta - J2000) + ttb) / JC;
  const precession =
    poly(t, [0.014506, 4612.156534, 1.3915817, -0.00000044, -0.000029956, -0.0000000368]) * DAS2R;
  return anp(era + precession);
}

/** Greenwich apparent sidereal time on the equinox path, radians. */
export function gst2006(jdUt1: number, jdTt: number, dpsi: number, epsa: number): number {
  return anp(gmst2006(jdUt1, jdTt) + dpsi * Math.cos(epsa) + complementaryEquinox(jdTt));
}

function biasPrecessionNutation(jdTt: number, dpsi: number, deps: number): Mat3 {
  const angles = fukushimaWilliams(jdTt);
  return mul(
    mul(mul(r1(-(angles.epsa + deps)), r3(-(angles.psib + dpsi))), r1(angles.phib)),
    r3(angles.gamb),
  );
}

/**
 * ITRF to EME2000.
 * `polar` is applied only when the caller has a measurement for this epoch.
 */
export function earthAttitude(jdUt1: number, jdTt: number, polar?: PolarMotion | null): EarthAttitude {
  const angles = fukushimaWilliams(jdTt);
  const nutation = nutation2000b(jdTt);
  const gst = gst2006(jdUt1, jdTt, nutation.dpsi, angles.epsa);
  const celestial = biasPrecessionNutation(jdTt, nutation.dpsi, nutation.deps);
  let terrestrial: Mat3 = r3(-gst);
  if (polar) {
    const polarMatrix = mul(r2(-polar.xpRad), r1(-polar.ypRad));
    terrestrial = mul(terrestrial, polarMatrix);
  }
  const gcrs = mul(transpose(celestial), terrestrial);
  const bias: Mat3 = [
    GCRS_TO_EME2000[0][0], GCRS_TO_EME2000[0][1], GCRS_TO_EME2000[0][2],
    GCRS_TO_EME2000[1][0], GCRS_TO_EME2000[1][1], GCRS_TO_EME2000[1][2],
    GCRS_TO_EME2000[2][0], GCRS_TO_EME2000[2][1], GCRS_TO_EME2000[2][2],
  ];
  return {
    itrfToEme2000: mul(bias, gcrs),
    ut1: "approximate",
    polarMotion: polar ? "observed" : "unavailable",
    bulletin: null,
    nutationRad: nutation,
    greenwichSiderealRad: gst,
  };
}
