/**
 * Planet position relative to its system barycenter.
 *
 * The snapshot places Earth about the Earth–Moon barycenter. It does not
 * place the other planets about theirs. Those planets use this rule.
 *
 * A satellite is a circle in the planet's equator. The equator is the
 * J2000 pole from `kernels/pck00011.tpc`; the pole rates are not applied.
 * Longitude is measured from the ascending node of that equator on the
 * EME2000 equator. At 2000-01-01.5 it is Ω + ω + M from the JPL mean
 * elements, and it then advances by one revolution per published period.
 * An inclination above 90° runs that angle backward. Inclination itself
 * is dropped onto the equator.
 *
 * The planet is the negative GM-weighted mean of those satellite
 * positions, so the system center of mass stays at the barycenter.
 * Satellites whose single contribution a·GM/(GM_planet+GM) is under 1 km
 * are omitted. Mercury, Venus, and Mars then sit on the barycenter.
 * This is not a satellite ephemeris and not a DE440 segment.
 *
 * GM and elements: JPL SSD planetary satellite physical parameters and
 * mean elements, epoch 2000-01-01.5. Planet GM as published there
 * (JUP365, SAT441, URA111, NEP097, PLU060).
 */

import pckText from "../../../kernels/pck00011.tpc?raw";
import { orbitCenter } from "../centers";
import { parsePckPoles } from "../pck";
import type { Vec3 } from "../types";

const DAY = 86400;
const DEG = Math.PI / 180;

type Satellite = {
  gmKm3s2: number;
  aKm: number;
  periodDays: number;
  /** Ω + ω + M at 2000-01-01.5, degrees. */
  lambda0Deg: number;
  retrograde: boolean;
};

type System = {
  barycenterName: string;
  planetId: number;
  planetName: string;
  label: string;
  gmKm3s2: number;
  satellites: readonly Satellite[];
};

const SYSTEMS: readonly System[] = [
  { barycenterName: "MERCURY BARYCENTER", planetId: 199, planetName: "MERCURY", label: "Mercury", gmKm3s2: 0, satellites: [] },
  { barycenterName: "VENUS BARYCENTER", planetId: 299, planetName: "VENUS", label: "Venus", gmKm3s2: 0, satellites: [] },
  { barycenterName: "MARS BARYCENTER", planetId: 499, planetName: "MARS", label: "Mars", gmKm3s2: 0, satellites: [] },
  {
    barycenterName: "JUPITER BARYCENTER",
    planetId: 599,
    planetName: "JUPITER",
    label: "Jupiter",
    gmKm3s2: 126686531.9,
    satellites: [
      { gmKm3s2: 5959.91547, aKm: 421800, periodDays: 1.762732, lambda0Deg: 0 + 49.1 + 330.9, retrograde: false },
      { gmKm3s2: 3202.7121, aKm: 671100, periodDays: 3.525463, lambda0Deg: 184 + 45 + 345.4, retrograde: false },
      { gmKm3s2: 9887.83275, aKm: 1070400, periodDays: 7.155588, lambda0Deg: 58.5 + 198.3 + 324.8, retrograde: false },
      { gmKm3s2: 7179.2834, aKm: 1882700, periodDays: 16.69044, lambda0Deg: 309.1 + 43.8 + 87.4, retrograde: false },
    ],
  },
  {
    barycenterName: "SATURN BARYCENTER",
    planetId: 699,
    planetName: "SATURN",
    label: "Saturn",
    gmKm3s2: 37931206.23,
    satellites: [
      { gmKm3s2: 153.94175, aKm: 527200, periodDays: 4.517503, lambda0Deg: 133.7 + 44.3 + 31.5, retrograde: false },
      { gmKm3s2: 8978.1371, aKm: 1221900, periodDays: 15.945448, lambda0Deg: 78.6 + 78.3 + 11.7, retrograde: false },
      { gmKm3s2: 120.51511, aKm: 3561700, periodDays: 79.331002, lambda0Deg: 86.5 + 254.5 + 74.8, retrograde: false },
    ],
  },
  {
    barycenterName: "URANUS BARYCENTER",
    planetId: 799,
    planetName: "URANUS",
    label: "Uranus",
    gmKm3s2: 5793951.3,
    satellites: [
      { gmKm3s2: 83.5, aKm: 190929, periodDays: 2.520379, lambda0Deg: 0 + 193.5 + 9.6, retrograde: false },
      { gmKm3s2: 85.1, aKm: 265986, periodDays: 4.144177, lambda0Deg: 174.8 + 253 + 183.4, retrograde: false },
      { gmKm3s2: 226.9, aKm: 436298, periodDays: 8.705869, lambda0Deg: 29.5 + 68.1 + 184, retrograde: false },
      { gmKm3s2: 205.3, aKm: 583511, periodDays: 13.463237, lambda0Deg: 76.8 + 143.6 + 132.2, retrograde: false },
    ],
  },
  {
    barycenterName: "NEPTUNE BARYCENTER",
    planetId: 899,
    planetName: "NEPTUNE",
    label: "Neptune",
    gmKm3s2: 6835099.97,
    satellites: [
      { gmKm3s2: 1428.49546, aKm: 354800, periodDays: 5.8792, lambda0Deg: 177.7 + 0 + 63, retrograde: true },
    ],
  },
  {
    barycenterName: "PLUTO BARYCENTER",
    planetId: 999,
    planetName: "PLUTO",
    label: "Pluto",
    gmKm3s2: 869.3,
    satellites: [
      { gmKm3s2: 106.1, aKm: 19600, periodDays: 6.387222, lambda0Deg: 0 + 304.1 + 0, retrograde: false },
    ],
  },
];

type Basis = { x: Vec3; y: Vec3 };

const BY_BARY = new Map(SYSTEMS.map((system) => [system.barycenterName, system]));
const BY_PLANET = new Map(SYSTEMS.map((system) => [system.planetId, system]));
const POLES = parsePckPoles(pckText);
const BASES = new Map<number, Basis>();

for (const system of SYSTEMS) {
  if (system.satellites.length === 0) continue;
  const pole = POLES.get(system.planetId);
  if (!pole) throw new Error(`kernels/pck00011.tpc has no pole for body ${system.planetId}`);
  BASES.set(system.planetId, equatorBasis(pole.raDeg, pole.decDeg));
}

export type BarycenterPlanet = {
  id: number;
  name: string;
  radiusKm: number;
};

/** The planet drawn about this center. Earth is absent: the snapshot already places it. */
export function barycenterPlanet(canonicalName: string): BarycenterPlanet | null {
  const system = BY_BARY.get(canonicalName);
  if (!system) return null;
  const radiusKm = orbitCenter(system.planetName)?.radiusKm;
  if (radiusKm == null) throw new Error(`${system.planetName} has no display radius`);
  return { id: system.planetId, name: system.label, radiusKm };
}

export type PlanetOffset = {
  positionKm: Vec3;
  velocityKmS: Vec3;
};

/**
 * Planet relative to its system barycenter, EME2000 kilometers.
 * `secondsPastJ2000` is the same ET argument the snapshot uses.
 * Unknown ids return null. A planet with no retained satellites is the zero vector.
 */
export function planetFromBarycenter(planetId: number, secondsPastJ2000: number): PlanetOffset | null {
  const system = BY_PLANET.get(planetId);
  if (!system) return null;
  const zero: Vec3 = [0, 0, 0];
  if (system.satellites.length === 0) return { positionKm: zero, velocityKmS: [0, 0, 0] };
  const basis = BASES.get(planetId);
  if (!basis) return null;
  let gm = system.gmKm3s2;
  const position: Vec3 = [0, 0, 0];
  const velocity: Vec3 = [0, 0, 0];
  for (const satellite of system.satellites) {
    gm += satellite.gmKm3s2;
    const motion = (satellite.retrograde ? -1 : 1) * (2 * Math.PI) / (satellite.periodDays * DAY);
    const angle = satellite.lambda0Deg * DEG + motion * secondsPastJ2000;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const weight = satellite.gmKm3s2;
    for (let axis = 0; axis < 3; axis += 1) {
      const arm = satellite.aKm * (cos * basis.x[axis] + sin * basis.y[axis]);
      const rate = satellite.aKm * motion * (-sin * basis.x[axis] + cos * basis.y[axis]);
      position[axis] += weight * arm;
      velocity[axis] += weight * rate;
    }
  }
  return {
    positionKm: scale(position, -1 / gm),
    velocityKmS: scale(velocity, -1 / gm),
  };
}

function equatorBasis(raDeg: number, decDeg: number): Basis {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const pole: Vec3 = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const node: Vec3 = [-pole[1], pole[0], 0];
  const nodeLength = Math.hypot(node[0], node[1], node[2]);
  const x = nodeLength > 1e-8 ? scale(node, 1 / nodeLength) : [1, 0, 0] as Vec3;
  const y: Vec3 = [
    pole[1] * x[2] - pole[2] * x[1],
    pole[2] * x[0] - pole[0] * x[2],
    pole[0] * x[1] - pole[1] * x[0],
  ];
  return { x, y };
}

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}
