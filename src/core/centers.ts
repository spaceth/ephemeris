/**
 * Subset of the SANA Orbit Centers registry
 * https://sanaregistry.org/r/orbit_centers/
 * Authority CCSDS.MOIMS.NAV, registry updated 2023-05-17.
 *
 * A recognized center can be evaluated and drawn relative to itself.
 * Inertial axes stay EME2000, GCRF, or ICRF. This table does not move
 * one center onto another.
 *
 * radiusKm is a display size only. It is the equatorial semi-axis of a
 * sphere. Except for Earth, that axis is `BODY*_RADII` element a from
 * `kernels/pck00011.tpc`, and only where a = b. Earth is the WGS 84 equatorial
 * radius. The kernel's polar axis is not drawn. Barycenters, Lagrange
 * points, and small bodies have no body: the origin is not that body's
 * surface, or the kernel radius is outside this profile.
 */

import pckText from "../../kernels/pck00011.tpc?raw";
import { equatorialRadiusKm, parsePckRadii } from "./pck";

export type OrbitCenter = {
  /** Canonical SANA value. */
  name: string;
  /** Equatorial radius in kilometers, when a body sphere is drawn. */
  radiusKm: number | null;
};

const WGS84_EQUATOR_KM = 6378.137;

/** NAIF body whose equatorial radii size the sphere. Earth is absent on purpose. */
const PCK_BODY: Readonly<Record<string, number>> = {
  MOON: 301,
  JUPITER: 599,
  MARS: 499,
  MERCURY: 199,
  NEPTUNE: 899,
  SATURN: 699,
  SUN: 10,
  URANUS: 799,
  VENUS: 299,
  PLUTO: 999,
};

const PCK_RADII = parsePckRadii(pckText);

function displayRadiusKm(name: string): number | null {
  if (name === "EARTH") return WGS84_EQUATOR_KM;
  const id = PCK_BODY[name];
  if (id == null) return null;
  const radii = PCK_RADII.get(id);
  if (!radii) throw new Error(`kernels/pck00011.tpc has no BODY${id}_RADII`);
  return equatorialRadiusKm(radii, id);
}

const ENTRIES: readonly OrbitCenter[] = [
  { name: "EARTH", radiusKm: displayRadiusKm("EARTH") },
  { name: "MOON", radiusKm: displayRadiusKm("MOON") },
  { name: "EARTH BARYCENTER", radiusKm: null },
  { name: "EARTH-MOON L1", radiusKm: null },
  { name: "EARTH-MOON L2", radiusKm: null },
  { name: "JUPITER", radiusKm: displayRadiusKm("JUPITER") },
  { name: "JUPITER BARYCENTER", radiusKm: null },
  { name: "MARS", radiusKm: displayRadiusKm("MARS") },
  { name: "MARS BARYCENTER", radiusKm: null },
  { name: "MERCURY", radiusKm: displayRadiusKm("MERCURY") },
  { name: "MERCURY BARYCENTER", radiusKm: null },
  { name: "NEPTUNE", radiusKm: displayRadiusKm("NEPTUNE") },
  { name: "NEPTUNE BARYCENTER", radiusKm: null },
  { name: "SATURN", radiusKm: displayRadiusKm("SATURN") },
  { name: "SATURN BARYCENTER", radiusKm: null },
  { name: "SOLAR SYSTEM BARYCENTER", radiusKm: null },
  { name: "SUN", radiusKm: displayRadiusKm("SUN") },
  { name: "SUN-EARTH L1", radiusKm: null },
  { name: "SUN-EARTH L2", radiusKm: null },
  { name: "URANUS", radiusKm: displayRadiusKm("URANUS") },
  { name: "URANUS BARYCENTER", radiusKm: null },
  { name: "VENUS", radiusKm: displayRadiusKm("VENUS") },
  { name: "VENUS BARYCENTER", radiusKm: null },
  { name: "101955 BENNU", radiusKm: null },
  { name: "11351 LEUCUS", radiusKm: null },
  { name: "132524 APL", radiusKm: null },
  { name: "15094 POLYMELE", radiusKm: null },
  { name: "162173 RYUGU", radiusKm: null },
  { name: "16 PSYCHE", radiusKm: null },
  { name: "1 CERES", radiusKm: null },
  { name: "21900 ORUS", radiusKm: null },
  { name: "21 LUTETIA", radiusKm: null },
  { name: "243 IDA", radiusKm: null },
  { name: "25143 ITOKAWA", radiusKm: null },
  { name: "253 MATHILDE", radiusKm: null },
  { name: "2867 STEINS", radiusKm: null },
  { name: "3200 PHAETHON", radiusKm: null },
  { name: "3548 EURYBATES", radiusKm: null },
  { name: "4179 TOUTATIS", radiusKm: null },
  { name: "433 EROS", radiusKm: null },
  { name: "4 VESTA", radiusKm: null },
  { name: "52246 DONALDJOHANSON", radiusKm: null },
  { name: "5525 ANNEFRANK", radiusKm: null },
  { name: "617 PATROCLUS", radiusKm: null },
  { name: "65803 DIDYMOS/DIMORPHOS", radiusKm: null },
  { name: "951 GASPRA", radiusKm: null },
  { name: "9969 BRAILLE", radiusKm: null },
  { name: "ARROKOTH", radiusKm: null },
  { name: "PLUTO", radiusKm: displayRadiusKm("PLUTO") },
  { name: "PLUTO BARYCENTER", radiusKm: null },
];

const BY_KEY = new Map(ENTRIES.map((entry) => [centerKey(entry.name), entry]));

export const ORBIT_CENTERS: readonly OrbitCenter[] = ENTRIES;

/** Compare a CENTER_NAME with the SANA value: case, extra space, and a parenthesized catalog number. */
export function centerKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[_\t\n\r]+/g, " ")
    .replace(/\(\s*(\d+)\s*\)\s*/g, "$1 ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

export function orbitCenter(name: string): OrbitCenter | null {
  return BY_KEY.get(centerKey(name)) ?? null;
}
