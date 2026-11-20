/**
 * IAU body-fixed orientation for the planets other than Earth and the Moon.
 *
 * The angles are the NAIF text PCK series in `kernels/pck00011.tpc`. Right
 * ascension and declination of the north pole are polynomials in Julian
 * centuries past J2000 TDB. The prime meridian is a polynomial in days.
 * Nutation terms, where the kernel has them, are sines of the system phase
 * angles for right ascension and the prime meridian, and cosines for
 * declination. The angles themselves are centuries past J2000.
 *
 * The inertial matrix takes body-fixed vectors into the PCK J2000 axes.
 * Body +X is the prime meridian, body +Y is east, and body +Z is north:
 *
 *   J2000 = transpose( [W]3 [π/2 − δ]1 [π/2 + α]3 ) · body
 *
 * The scene matrix is that rotation written for a Y-up mesh whose local +X
 * is longitude 0° and whose local +Y is north, the same placement the Earth
 * and Moon meshes already use. No extra longitude offset is applied. The
 * PCK labels these axes J2000; they are the ICRF, and the EME2000 frame bias
 * is left off because it sits under the accuracy of the series.
 *
 * Earth and the Moon are not evaluated here. Their meshes keep the models
 * in `orientation.ts` and `globe.ts`.
 */

import pckText from "../../../kernels/pck00011.tpc?raw";
import type { Mat3 } from "../globe";
import { parsePckRotations, type PckRotation } from "../pck";
import { DAYSEC } from "../time";

const J2000_CENTURY_DAYS = 36525;
const DEG = Math.PI / 180;
const TURN = Math.PI * 2;

/** Scene axes from the PCK J2000 axes: (x, y, z) → (x, z, −y). */
const J2000_TO_SCENE: Mat3 = [1, 0, 0, 0, 0, 1, 0, -1, 0];
/** Inverse of `J2000_TO_SCENE`. Mesh +X stays +X, mesh +Y is body north. */
const SCENE_TO_J2000: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];

/**
 * NAIF ids whose meshes use this model.
 * 399 and 301 are absent on purpose.
 */
const IAU_PLANETS = new Set([199, 299, 499, 599, 699, 799, 899, 999]);

const ROTATIONS = parsePckRotations(pckText);

for (const id of IAU_PLANETS) {
  if (!ROTATIONS.has(id)) throw new Error(`pck00011 has no IAU rotation for NAIF ${id}`);
}

export type IauPose = {
  /** Right ascension of the north pole, radians. */
  ra: number;
  /** Declination of the north pole, radians. */
  dec: number;
  /** Prime meridian east of the node, radians. */
  w: number;
  /** Body-fixed column vector to PCK J2000. Row-major. */
  j2000FromBody: Mat3;
  /**
   * Mesh local to scene. Local +X is longitude 0° and local +Y is north.
   * Row-major, the matrix `Quaternion.setFromRotationMatrix` consumes.
   */
  scene: Mat3;
};

/**
 * Orientation at TDB seconds past J2000. The instant is absolute, so playback
 * forward and backward evaluates the same series. `null` for every body this
 * model does not own, including Earth, the Moon, and the Sun.
 */
export function planetPose(naifId: number, tdbSecondsPastJ2000: number): IauPose | null {
  if (!IAU_PLANETS.has(naifId)) return null;
  const model = ROTATIONS.get(naifId);
  if (!model) return null;
  return poseAt(model, tdbSecondsPastJ2000);
}

function poseAt(model: PckRotation, tdbSecondsPastJ2000: number): IauPose {
  const days = tdbSecondsPastJ2000 / DAYSEC;
  const centuries = days / J2000_CENTURY_DAYS;
  let raDeg = series(model.ra, centuries);
  let decDeg = series(model.dec, centuries);
  let w = reducedRadians(model.pm, days);
  for (let index = 0; index < model.angles.length; index += 1) {
    const theta = reducedRadians(model.angles[index], centuries);
    const sine = Math.sin(theta);
    const cosine = Math.cos(theta);
    raDeg += (model.nutRa[index] ?? 0) * sine;
    decDeg += (model.nutDec[index] ?? 0) * cosine;
    w += (model.nutPm[index] ?? 0) * sine * DEG;
  }
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const j2000FromBody = j2000FromIau(ra, dec, w);
  return {
    ra,
    dec,
    w,
    j2000FromBody,
    scene: mul(mul(J2000_TO_SCENE, j2000FromBody), SCENE_TO_J2000),
  };
}

/**
 * Power series reduced to one turn before it becomes radians.
 * The prime meridian and the phase angles run through many revolutions.
 * Dividing each coefficient by 360 first keeps the fractional turn.
 */
function reducedRadians(coeffs: readonly number[], t: number): number {
  let turns = 0;
  let power = 1;
  for (const coeff of coeffs) {
    turns += (coeff / 360) * power;
    power *= t;
  }
  return (turns - Math.floor(turns)) * TURN;
}

function series(coeffs: readonly number[], t: number): number {
  let sum = 0;
  let power = 1;
  for (const coeff of coeffs) {
    sum += coeff * power;
    power *= t;
  }
  return sum;
}

/** Body-fixed to PCK J2000. `[W]3 [π/2 − δ]1 [π/2 + α]3` maps the other way. */
function j2000FromIau(ra: number, dec: number, w: number): Mat3 {
  const toBody = mul(mul(r3(w), r1(Math.PI / 2 - dec)), r3(Math.PI / 2 + ra));
  return transpose(toBody);
}

/** Positive rotation of the frame about X. Same sense as the SPICE and SOFA R1. */
function r1(phi: number): Mat3 {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/** Positive rotation of the frame about Z. */
function r3(psi: number): Mat3 {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
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

function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
