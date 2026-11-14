/**
 * One revolution of a body about its anchor, in EME2000 meters relative to that anchor.
 * Planets are sampled about the Sun. The Earth's Moon is sampled about the Earth.
 * The other moons use the circle rule about their planet.
 * The DE440 cut is 1950–2050. A period longer than that window is finished as the
 * Kepler ellipse of the state inside the cut, so the ring still closes.
 */

import { CATALOG_MOONS, moonPeriodDays } from "../core/ephemeris/barycenter";
import { place, placeMotion } from "../core/ephemeris/place";
import type { SpkKernel } from "../core/ephemeris/resolve";
import type { Vec3 } from "../core/types";

const DAY = 86400;
/** Requested cut of the committed planetary snapshot, TDB seconds past J2000. */
const COVERAGE_START = -1_577_880_000;
const COVERAGE_STOP = 1_577_880_000;
const SAMPLES = 128;
/** Solar GM, m³/s². Used only to close an orbit the snapshot cannot cover. */
const SUN_GM = 1.32712440018e20;

export const ORBIT_PILLS = [
  { id: "mercury", label: "Mercury" },
  { id: "venus", label: "Venus" },
  { id: "earth", label: "Earth" },
  { id: "mars", label: "Mars" },
  { id: "jupiter", label: "Jupiter" },
  { id: "saturn", label: "Saturn" },
  { id: "uranus", label: "Uranus" },
  { id: "neptune", label: "Neptune" },
  { id: "pluto", label: "Pluto" },
  { id: "earth-moon", label: "Earth Moon" },
  { id: "planet-moons", label: "Planet's Moon" },
] as const;

export type OrbitLineId = (typeof ORBIT_PILLS)[number]["id"];
export type OrbitToggles = Record<OrbitLineId, boolean>;

export const DEFAULT_ORBITS: OrbitToggles = {
  mercury: false,
  venus: false,
  earth: false,
  mars: false,
  jupiter: false,
  saturn: false,
  uranus: false,
  neptune: false,
  pluto: false,
  "earth-moon": false,
  "planet-moons": false,
};

/** Solar view has no spacecraft path, so every ring starts on. */
export const SOLAR_ORBITS: OrbitToggles = {
  mercury: true,
  venus: true,
  earth: true,
  mars: true,
  jupiter: true,
  saturn: true,
  uranus: true,
  neptune: true,
  pluto: true,
  "earth-moon": true,
  "planet-moons": true,
};

export type OrbitTrackSpec = {
  key: string;
  bodyId: number;
  anchorId: number;
  periodDays: number;
};

const PLANETS: readonly (OrbitTrackSpec & { id: OrbitLineId })[] = [
  { id: "mercury", key: "mercury", bodyId: 199, anchorId: 10, periodDays: 87.969 },
  { id: "venus", key: "venus", bodyId: 299, anchorId: 10, periodDays: 224.701 },
  { id: "earth", key: "earth", bodyId: 399, anchorId: 10, periodDays: 365.256 },
  { id: "mars", key: "mars", bodyId: 499, anchorId: 10, periodDays: 686.98 },
  { id: "jupiter", key: "jupiter", bodyId: 599, anchorId: 10, periodDays: 4332.589 },
  { id: "saturn", key: "saturn", bodyId: 699, anchorId: 10, periodDays: 10759.22 },
  { id: "uranus", key: "uranus", bodyId: 799, anchorId: 10, periodDays: 30685.4 },
  { id: "neptune", key: "neptune", bodyId: 899, anchorId: 10, periodDays: 60189 },
  { id: "pluto", key: "pluto", bodyId: 999, anchorId: 10, periodDays: 90560 },
];

/** Tracks for the pills that are on. Planet moons are one pill and many rings. */
export function orbitTrackSpecs(orbits: OrbitToggles): OrbitTrackSpec[] {
  const specs: OrbitTrackSpec[] = [];
  for (const planet of PLANETS) {
    if (orbits[planet.id]) specs.push(planet);
  }
  if (orbits["earth-moon"]) {
    specs.push({ key: "earth-moon", bodyId: 301, anchorId: 399, periodDays: 27.321661 });
  }
  if (orbits["planet-moons"]) {
    for (const moon of CATALOG_MOONS) {
      const periodDays = moonPeriodDays(moon.id);
      if (periodDays == null) continue;
      specs.push({ key: `moon-${moon.id}`, bodyId: moon.id, anchorId: moon.planetId, periodDays });
    }
  }
  return specs;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * One closed ellipse through `position` with the curvature of `velocity`.
 * True anomaly is stepped a full turn, then the first point is repeated.
 */
function keplerLoop(position: Vec3, velocity: Vec3): Float32Array | null {
  const radius = Math.hypot(position[0], position[1], position[2]);
  const speed2 = dot(velocity, velocity);
  if (!(radius > 0) || !(speed2 > 0)) return null;
  const energy = speed2 / 2 - SUN_GM / radius;
  if (!(energy < 0)) return null;
  const semiMajor = -SUN_GM / (2 * energy);
  const angular = cross(position, velocity);
  const angularMag = Math.hypot(angular[0], angular[1], angular[2]);
  if (!(angularMag > 0)) return null;
  const eccentricityVec = addVec(scale(cross(velocity, angular), 1 / SUN_GM), scale(position, -1 / radius));
  const eccentricity = Math.hypot(eccentricityVec[0], eccentricityVec[1], eccentricityVec[2]);
  if (!(eccentricity < 1)) return null;
  const periapsis = eccentricity > 1e-8 ? scale(eccentricityVec, 1 / eccentricity) : scale(position, 1 / radius);
  const pole = scale(angular, 1 / angularMag);
  const quarter = cross(pole, periapsis);
  const semiLatus = semiMajor * (1 - eccentricity * eccentricity);
  if (!(semiLatus > 0)) return null;
  const coords: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const anomaly = (index / SAMPLES) * Math.PI * 2;
    const distance = semiLatus / (1 + eccentricity * Math.cos(anomaly));
    const point = addVec(scale(periapsis, distance * Math.cos(anomaly)), scale(quarter, distance * Math.sin(anomaly)));
    coords.push(point[0], point[1], point[2]);
  }
  coords.push(coords[0], coords[1], coords[2]);
  return Float32Array.from(coords);
}

/**
 * EME2000 meters of `bodyId` relative to `anchorId` across one period centered on `nowEt`.
 * A period inside the snapshot is sampled from the kernel and closed.
 * A longer period is the Kepler ellipse of a state inside the cut, still one full ring.
 * A failed sample returns null.
 */
export function sampleOrbit(
  bodyId: number,
  anchorId: number,
  periodDays: number,
  nowEt: number,
  kernels: readonly SpkKernel[],
): Float32Array | null {
  const period = periodDays * DAY;
  if (!(period > 0)) return null;
  const available = COVERAGE_STOP - COVERAGE_START;
  if (period > available) {
    const et = Math.min(COVERAGE_STOP, Math.max(COVERAGE_START, nowEt));
    const motion = placeMotion(bodyId, anchorId, kernels, et);
    if (!motion.ok) return null;
    return keplerLoop(motion.positionM, motion.velocityMps);
  }
  const span = period;
  let start = nowEt - span / 2;
  if (start < COVERAGE_START) start = COVERAGE_START;
  if (start + span > COVERAGE_STOP) start = COVERAGE_STOP - span;
  const coords: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const placed = place(bodyId, anchorId, kernels, start + (span * index) / SAMPLES);
    if (!placed.ok) return null;
    coords.push(placed.positionM[0], placed.positionM[1], placed.positionM[2]);
  }
  if (coords.length < 6) return null;
  coords.push(coords[0], coords[1], coords[2]);
  return Float32Array.from(coords);
}
