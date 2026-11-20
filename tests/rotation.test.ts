import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { BODIES, bodyByName } from "../src/core/ephemeris/bodies";
import { planetPose, type IauPose } from "../src/core/ephemeris/rotation";
import { parsePckRotations, type PckRotation } from "../src/core/pck";
import type { Mat3 } from "../src/core/globe";

const DEG = Math.PI / 180;
const DAY = 86400;
const text = readFileSync(new URL("../kernels/pck00011.tpc", import.meta.url), "utf8");
const models = parsePckRotations(text);

function column(m: Mat3, col: number): [number, number, number] {
  return [m[col], m[3 + col], m[6 + col]];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v: readonly number[]): [number, number, number] {
  const scale = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / scale, v[1] / scale, v[2] / scale];
}

/** Right-hand rotation of `vector` about a unit axis. */
function rodrigues(vector: readonly number[], axis: readonly number[], angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const turned = cross(axis, vector);
  const along = dot(axis, vector);
  return [
    vector[0] * c + turned[0] * s + axis[0] * along * (1 - c),
    vector[1] * c + turned[1] * s + axis[1] * along * (1 - c),
    vector[2] * c + turned[2] * s + axis[2] * along * (1 - c),
  ];
}

function signedAngle(from: readonly number[], to: readonly number[], axis: readonly number[]): number {
  return Math.atan2(dot(cross(from, to), axis), dot(from, to));
}

function poly(coeffs: readonly number[], t: number): number {
  return coeffs.reduce((sum, coeff, index) => sum + coeff * t ** index, 0);
}

/** The IAU sums, without the turn reduction used for fast angles. */
function naive(model: PckRotation, days: number): { ra: number; dec: number; w: number } {
  const centuries = days / 36525;
  let ra = poly(model.ra, centuries);
  let dec = poly(model.dec, centuries);
  let w = poly(model.pm, days);
  for (let index = 0; index < model.angles.length; index += 1) {
    const theta = poly(model.angles[index], centuries) * DEG;
    ra += (model.nutRa[index] ?? 0) * Math.sin(theta);
    dec += (model.nutDec[index] ?? 0) * Math.cos(theta);
    w += (model.nutPm[index] ?? 0) * Math.sin(theta);
  }
  return { ra: ra * DEG, dec: dec * DEG, w: w * DEG };
}

function wrapPi(angle: number): number {
  const turns = angle / (Math.PI * 2);
  const frac = turns - Math.floor(turns);
  const wrapped = frac * Math.PI * 2;
  return wrapped > Math.PI ? wrapped - Math.PI * 2 : wrapped;
}

function pose(id: number, days = 0): IauPose {
  const oriented = planetPose(id, days * DAY);
  expect(oriented).not.toBeNull();
  if (!oriented) throw new Error(`NAIF ${id} has no pose`);
  return oriented;
}

describe("PCK rotation angles", () => {
  it("keeps the last assignment and the phase-angle grouping", () => {
    const parsed = parsePckRotations(`\\begindata
BODY299_POLE_RA = ( 1 2 3 )
BODY299_POLE_DEC = ( 4 5 6 )
BODY299_PM = ( 7 8 9 )
BODY2_MAX_PHASE_DEGREE = 1
BODY2_NUT_PREC_ANGLES = ( 10 20 30 40 )
BODY299_NUT_PREC_PM = ( 0.25 0.5 )
\\begintext
BODY299_PM = ( 0 0 0 )
\\begindata
BODY299_PM = ( 70 80 90 )
BODY4_MAX_PHASE_DEGREE = 2
BODY4_NUT_PREC_ANGLES = ( 1 2 3 4 5 6 )
BODY499_POLE_RA = ( 9 0 0 )
BODY499_POLE_DEC = ( 8 0 0 )
BODY499_PM = ( 7 6 0 )
BODY499_NUT_PREC_RA = ( 0.1 0.2 )
`);
    expect(parsed.get(299)?.pm).toEqual([70, 80, 90]);
    expect(parsed.get(299)?.angles).toEqual([
      [10, 20],
      [30, 40],
    ]);
    expect(parsed.get(499)?.angles).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("rejects nutation terms with no phase angles, and a group that does not match the degree", () => {
    expect(() =>
      parsePckRotations(`\\begindata
BODY199_POLE_RA = ( 1 0 0 )
BODY199_POLE_DEC = ( 2 0 0 )
BODY199_PM = ( 3 4 0 )
BODY199_NUT_PREC_PM = ( 0.1 )
`),
    ).toThrow(/BODY1_NUT_PREC_ANGLES/);
    expect(() =>
      parsePckRotations(`\\begindata
BODY4_MAX_PHASE_DEGREE = 2
BODY4_NUT_PREC_ANGLES = ( 1 2 3 4 )
BODY499_POLE_RA = ( 1 0 0 )
BODY499_POLE_DEC = ( 2 0 0 )
BODY499_PM = ( 3 4 0 )
BODY499_NUT_PREC_RA = ( 0.1 )
`),
    ).toThrow(/groups of 3/);
  });

  it("reads the current planet series from pck00011, not the commented predecessors", () => {
    const mars = models.get(499);
    const jupiter = models.get(599);
    const venus = models.get(299);
    const uranus = models.get(799);
    expect(mars && jupiter && venus && uranus).toBeTruthy();
    if (!mars || !jupiter || !venus || !uranus) return;
    expect(mars.angles).toHaveLength(26);
    expect(mars.angles[4]).toHaveLength(3);
    expect(mars.angles[4][2]).toBeCloseTo(12.711923222, 6);
    expect(mars.pm[1]).toBeCloseTo(350.891982443297, 9);
    expect(jupiter.angles).toHaveLength(15);
    expect(jupiter.angles[10][0]).toBeCloseTo(99.360714, 6);
    expect(jupiter.angles[10][1]).toBeCloseTo(4850.4046, 4);
    expect(jupiter.nutRa[10]).toBeCloseTo(0.000117, 8);
    expect(jupiter.nutPm.every((term) => term === 0)).toBe(true);
    expect(jupiter.pm[1]).toBeCloseTo(870.536, 6);
    expect(venus.angles).toHaveLength(0);
    expect(venus.pm[1]).toBeCloseTo(-1.4813688, 7);
    expect(uranus.pm[1]).toBeLessThan(0);
    expect(uranus.dec[0]).toBeCloseTo(-15.175, 6);
  });
});

describe("planet orientation", () => {
  it("leaves Earth, the Moon, and the Sun on their existing paths", () => {
    expect(planetPose(399, 0)).toBeNull();
    expect(planetPose(301, 0)).toBeNull();
    expect(planetPose(10, 0)).toBeNull();
    expect(planetPose(501, 0)).toBeNull();
    expect(BODIES.filter((body) => body.attitude === "iau").map((body) => body.id)).toEqual([
      199, 299, 499, 599, 699, 799, 899, 999,
    ]);
    expect(bodyByName("EARTH")?.attitude).toBe("earth");
    expect(bodyByName("MOON")?.attitude).toBe("moon");
    expect(bodyByName("SUN")?.attitude).toBe("none");
    expect(BODIES.filter((body) => body.placement === "satellite").every((body) => body.attitude === "none")).toBe(true);
  });

  it("points the pole and the prime meridian with no extra longitude offset", () => {
    const venus = pose(299);
    const north = [
      Math.cos(venus.dec) * Math.cos(venus.ra),
      Math.cos(venus.dec) * Math.sin(venus.ra),
      Math.sin(venus.dec),
    ];
    const node = unit(cross([0, 0, 1], north));
    const meridian = rodrigues(node, unit(north), venus.w);
    const bodyX = column(venus.j2000FromBody, 0);
    const bodyZ = column(venus.j2000FromBody, 2);
    expect(bodyZ[0]).toBeCloseTo(north[0], 12);
    expect(bodyZ[1]).toBeCloseTo(north[1], 12);
    expect(bodyZ[2]).toBeCloseTo(north[2], 12);
    expect(bodyX[0]).toBeCloseTo(meridian[0], 12);
    expect(bodyX[1]).toBeCloseTo(meridian[1], 12);
    expect(bodyX[2]).toBeCloseTo(meridian[2], 12);
    expect(venus.ra).toBeCloseTo(272.76 * DEG, 10);
    expect(venus.dec).toBeCloseTo(67.16 * DEG, 10);
    expect(venus.w).toBeCloseTo(160.2 * DEG, 10);
    const sceneMeridian = column(venus.scene, 0);
    const sceneNorth = column(venus.scene, 1);
    expect(sceneMeridian).toEqual([
      expect.closeTo(bodyX[0], 12),
      expect.closeTo(bodyX[2], 12),
      expect.closeTo(-bodyX[1], 12),
    ]);
    expect(sceneNorth).toEqual([
      expect.closeTo(bodyZ[0], 12),
      expect.closeTo(bodyZ[2], 12),
      expect.closeTo(-bodyZ[1], 12),
    ]);
  });

  it("includes nutation and distinguishes days from centuries", () => {
    for (const id of [199, 499, 599, 899]) {
      const model = models.get(id);
      expect(model).toBeDefined();
      if (!model) continue;
      for (const days of [0, 1, 36525 / 2]) {
        const oriented = pose(id, days);
        const expected = naive(model, days);
        expect(oriented.ra).toBeCloseTo(expected.ra, 8);
        expect(oriented.dec).toBeCloseTo(expected.dec, 8);
        expect(wrapPi(oriented.w - expected.w)).toBeCloseTo(0, 8);
      }
    }
    const jupiter = pose(599);
    let ra = 268.056595;
    let dec = 64.495303;
    const waves = [
      [99.360714, 0.000117, 0.00005],
      [175.895369, 0.000938, 0.000404],
      [300.323162, 0.001432, 0.000617],
      [114.012305, 0.00003, -0.000013],
      [49.511251, 0.00215, 0.000926],
    ];
    for (const [angle, dra, ddec] of waves) {
      ra += dra * Math.sin(angle * DEG);
      dec += ddec * Math.cos(angle * DEG);
    }
    expect(jupiter.ra).toBeCloseTo(ra * DEG, 8);
    expect(jupiter.dec).toBeCloseTo(dec * DEG, 8);
    expect(jupiter.w).toBeCloseTo(284.95 * DEG, 8);
    const neptune = pose(899);
    const node = 357.85 * DEG;
    expect(neptune.dec).toBeCloseTo((43.46 - 0.51 * Math.cos(node)) * DEG, 8);
    expect(neptune.ra).not.toBeCloseTo(299.36 * DEG, 4);
  });

  it("spins prograde and retrograde, including when time runs backward", () => {
    const step = 0.01;
    const rates: { id: number; perDay: number }[] = [
      { id: 299, perDay: -1.4813688 },
      { id: 499, perDay: 350.891982443297 },
      { id: 799, perDay: -501.1600928 },
      { id: 599, perDay: 870.536 },
    ];
    for (const { id, perDay } of rates) {
      const now = pose(id);
      const ahead = pose(id, step);
      const behind = pose(id, -step);
      const pole = column(now.j2000FromBody, 2);
      const forward = signedAngle(column(now.j2000FromBody, 0), column(ahead.j2000FromBody, 0), pole);
      const reverse = signedAngle(column(now.j2000FromBody, 0), column(behind.j2000FromBody, 0), pole);
      expect(forward * (180 / Math.PI)).toBeCloseTo(perDay * step, 3);
      expect(reverse).toBeCloseTo(-forward, 6);
    }
    const venusPeriod = 360 / 1.4813688;
    const returned = pose(299, venusPeriod);
    const start = pose(299);
    expect(dot(column(start.j2000FromBody, 0), column(returned.j2000FromBody, 0))).toBeCloseTo(1, 8);
  });

  it("moves Saturn's pole with the century rate and keeps a fast meridian exact far from J2000", () => {
    const saturn = pose(699, 36525);
    const pole = column(saturn.j2000FromBody, 2);
    const ra = 40.589 - 0.036;
    const dec = 83.537 - 0.004;
    expect(Math.atan2(pole[1], pole[0])).toBeCloseTo(ra * DEG, 8);
    expect(Math.asin(pole[2])).toBeCloseTo(dec * DEG, 8);
    for (const days of [20000, -20000]) {
      const turns = 284.95 / 360 + (870.536 / 360) * days;
      const expected = (turns - Math.floor(turns)) * Math.PI * 2;
      expect(pose(599, days).w).toBeCloseTo(expected, 8);
    }
    expect(pose(999).dec).toBeCloseTo(-6.163 * DEG, 8);
    expect(pose(799).dec).toBeLessThan(0);
  });

  it("is the quaternion Three.js applies to the mesh axes", () => {
    const venus = pose(299, 40);
    const matrix = new Matrix4().set(
      venus.scene[0], venus.scene[1], venus.scene[2], 0,
      venus.scene[3], venus.scene[4], venus.scene[5], 0,
      venus.scene[6], venus.scene[7], venus.scene[8], 0,
      0, 0, 0, 1,
    );
    const quaternion = new Quaternion().setFromRotationMatrix(matrix);
    const north = new Vector3(0, 1, 0).applyQuaternion(quaternion);
    const meridian = new Vector3(1, 0, 0).applyQuaternion(quaternion);
    expect(north.x).toBeCloseTo(venus.scene[1], 10);
    expect(north.y).toBeCloseTo(venus.scene[4], 10);
    expect(north.z).toBeCloseTo(venus.scene[7], 10);
    expect(meridian.x).toBeCloseTo(venus.scene[0], 10);
    expect(meridian.y).toBeCloseTo(venus.scene[3], 10);
    expect(meridian.z).toBeCloseTo(venus.scene[6], 10);
    const again = pose(299, 40);
    expect(again.scene).toEqual(venus.scene);
  });
});
