/**
 * Subset of the SANA Orbit Centers registry
 * https://sanaregistry.org/r/orbit_centers/
 * Authority CCSDS.MOIMS.NAV, registry updated 2023-05-17.
 *
 * A recognized center can be evaluated and drawn relative to itself.
 * Inertial axes stay EME2000, GCRF, or ICRF. This table does not move
 * one center onto another.
 *
 * radiusKm is a display size only. The Sun is an untextured sphere of the
 * IAU nominal solar radius. Planet and Moon values are IAU equatorial
 * radii and are drawn as spheres. Earth is the WGS84 equatorial radius
 * the scene already used. Pluto is the New Horizons mean radius.
 * Barycenters, Lagrange points, and small bodies have no body: the
 * origin is not that body's surface, or a radius is outside this profile.
 */

export type OrbitCenter = {
  /** Canonical SANA value. */
  name: string;
  /** Equatorial radius in kilometers, when a body sphere is drawn. */
  radiusKm: number | null;
};

const WGS84_EQUATOR_KM = 6378.137;

const ENTRIES: readonly OrbitCenter[] = [
  { name: "EARTH", radiusKm: WGS84_EQUATOR_KM },
  { name: "MOON", radiusKm: 1737.4 },
  { name: "EARTH BARYCENTER", radiusKm: null },
  { name: "EARTH-MOON L1", radiusKm: null },
  { name: "EARTH-MOON L2", radiusKm: null },
  { name: "JUPITER", radiusKm: 71492 },
  { name: "JUPITER BARYCENTER", radiusKm: null },
  { name: "MARS", radiusKm: 3396.19 },
  { name: "MARS BARYCENTER", radiusKm: null },
  { name: "MERCURY", radiusKm: 2439.4 },
  { name: "MERCURY BARYCENTER", radiusKm: null },
  { name: "NEPTUNE", radiusKm: 24764 },
  { name: "NEPTUNE BARYCENTER", radiusKm: null },
  { name: "SATURN", radiusKm: 60268 },
  { name: "SATURN BARYCENTER", radiusKm: null },
  { name: "SOLAR SYSTEM BARYCENTER", radiusKm: null },
  { name: "SUN", radiusKm: 695700 },
  { name: "SUN-EARTH L1", radiusKm: null },
  { name: "SUN-EARTH L2", radiusKm: null },
  { name: "URANUS", radiusKm: 25559 },
  { name: "URANUS BARYCENTER", radiusKm: null },
  { name: "VENUS", radiusKm: 6051.8 },
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
  { name: "PLUTO", radiusKm: 1188.3 },
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
