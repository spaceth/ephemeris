/**
 * One drawing record per body the scene can place.
 * `orbitCenter` remains the SANA name check. This table is not a second registry.
 * A texture path is set only for maps already in the repository.
 * Mars through Pluto have no planet-center segment in DE440. They chain
 * their system barycenter and then add the circle-rule offset.
 * Mercury and Venus do have those segments, so they chain 199 and 299.
 */

import pckText from "../../../kernels/pck00011.tpc?raw";
import { orbitCenter } from "../centers";
import { parsePckRadii } from "../pck";
import { CATALOG_MOONS } from "./barycenter";
import type { NaifId } from "./state";

export type BodyAttitude = "earth" | "moon" | "none";

/** Which mesh reads this record. Minimal style still draws a gray sphere, except the Sun. */
export type BodyAppearance = "sun" | "earth" | "moon" | "sphere";

export type BodyPlacement = "snapshot" | "barycenter-offset" | "satellite";

export type BodyRecord = {
  id: NaifId;
  /** Canonical SANA name. */
  name: string;
  label: string;
  radiusKm: number | null;
  /** Color map, or none. Pluto and the moons stay untextured. */
  texture: string | null;
  /** Radial ring strip, or none. Saturn is the only filled entry. */
  ring: string | null;
  attitude: BodyAttitude;
  appearance: BodyAppearance;
  placement: BodyPlacement;
  /**
   * SPK target walked to the solar-system barycenter.
   * A barycenter-offset planet walks its system barycenter, not the planet id.
   * A satellite walks that same barycenter, then the circle-rule arm.
   */
  chain: NaifId;
  /** Planet whose label this moon yields to while the two names sit together. */
  primaryId: number | null;
};

const MERCURY_COLOR = "/textures/mercury.jpg";
const VENUS_COLOR = "/textures/venus.jpg";
const EARTH_DAY = "/textures/earth-day.jpg";
const MOON_COLOR = "/textures/moon.jpg";
const MARS_COLOR = "/textures/mars.jpg";
const JUPITER_COLOR = "/textures/jupiter.jpg";
const SATURN_COLOR = "/textures/saturn.jpg";
const SATURN_RING = "/textures/saturn-ring.png";
const URANUS_COLOR = "/textures/uranus.jpg";
const NEPTUNE_COLOR = "/textures/neptune.jpg";

function sized(name: string): number {
  const radiusKm = orbitCenter(name)?.radiusKm;
  if (radiusKm == null) throw new Error(`${name} has no display radius`);
  return radiusKm;
}

const PCK_RADII = parsePckRadii(pckText);

function moonRadiusKm(id: number): number {
  const radii = PCK_RADII.get(id);
  if (!radii) throw new Error(`kernels/pck00011.tpc has no BODY${id}_RADII`);
  return (radii[0] + radii[1]) / 2;
}

function body(
  id: number,
  name: string,
  label: string,
  appearance: BodyAppearance,
  attitude: BodyAttitude,
  texture: string | null,
  placement: BodyPlacement,
  chain: number,
  radiusKm: number | null,
  primaryId: number | null = null,
  ring: string | null = null,
): BodyRecord {
  return { id, name, label, radiusKm, texture, ring, attitude, appearance, placement, chain, primaryId };
}

function barycenter(id: number, name: string): BodyRecord {
  return body(id, name, name, "sphere", "none", null, "snapshot", id, null);
}

function planet(
  id: number,
  name: string,
  label: string,
  appearance: BodyAppearance,
  attitude: BodyAttitude,
  texture: string | null,
  placement: BodyPlacement,
  chain: number,
  primaryId: number | null = null,
  ring: string | null = null,
): BodyRecord {
  return body(id, name, label, appearance, attitude, texture, placement, chain, sized(name), primaryId, ring);
}

/**
 * Targets copied into the planetary snapshot, in DE440 file order.
 * 499 through 999 are not in that kernel as planet-center states.
 */
export const SNAPSHOT_TARGETS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 301, 399, 199, 299];

export const BODIES: readonly BodyRecord[] = [
  barycenter(0, "SOLAR SYSTEM BARYCENTER"),
  barycenter(1, "MERCURY BARYCENTER"),
  barycenter(2, "VENUS BARYCENTER"),
  barycenter(3, "EARTH BARYCENTER"),
  barycenter(4, "MARS BARYCENTER"),
  barycenter(5, "JUPITER BARYCENTER"),
  barycenter(6, "SATURN BARYCENTER"),
  barycenter(7, "URANUS BARYCENTER"),
  barycenter(8, "NEPTUNE BARYCENTER"),
  barycenter(9, "PLUTO BARYCENTER"),
  planet(10, "SUN", "Sun", "sun", "none", null, "snapshot", 10),
  planet(199, "MERCURY", "Mercury", "sphere", "none", MERCURY_COLOR, "snapshot", 199),
  planet(299, "VENUS", "Venus", "sphere", "none", VENUS_COLOR, "snapshot", 299),
  planet(399, "EARTH", "Earth", "earth", "earth", EARTH_DAY, "snapshot", 399),
  planet(301, "MOON", "Moon", "moon", "moon", MOON_COLOR, "snapshot", 301, 399),
  planet(499, "MARS", "Mars", "sphere", "none", MARS_COLOR, "barycenter-offset", 4),
  planet(599, "JUPITER", "Jupiter", "sphere", "none", JUPITER_COLOR, "barycenter-offset", 5),
  planet(699, "SATURN", "Saturn", "sphere", "none", SATURN_COLOR, "barycenter-offset", 6, null, SATURN_RING),
  planet(799, "URANUS", "Uranus", "sphere", "none", URANUS_COLOR, "barycenter-offset", 7),
  planet(899, "NEPTUNE", "Neptune", "sphere", "none", NEPTUNE_COLOR, "barycenter-offset", 8),
  planet(999, "PLUTO", "Pluto", "sphere", "none", null, "barycenter-offset", 9),
  ...CATALOG_MOONS.map((moon) =>
    body(moon.id, moon.label.toUpperCase(), moon.label, "sphere", "none", null, "satellite", moon.chain, moonRadiusKm(moon.id), moon.planetId),
  ),
];

/** Planet label a moon yields to while the two names sit together. */
export function labelPrimary(bodyId: number): number | null {
  return BY_ID.get(bodyId)?.primaryId ?? null;
}

/** Spans reserved for neighbor names. One per sized body, including the case where the center is a barycenter. */
export const BODY_LABEL_COUNT = BODIES.filter((item) => item.radiusKm != null).length;

const BY_ID = new Map(BODIES.map((item) => [item.id, item]));
const BY_NAME = new Map(BODIES.map((item) => [item.name, item]));

export function bodyById(id: number): BodyRecord | null {
  return BY_ID.get(id) ?? null;
}

export function bodyByName(canonicalName: string): BodyRecord | null {
  return BY_NAME.get(canonicalName) ?? null;
}

/** Screen-name group for a drawn body. */
export type BodyLabelKind = "sun" | "planet" | "moon" | "barycenter" | "lagrange";

export function bodyLabelKind(id: number): BodyLabelKind | null {
  const body = bodyById(id);
  if (!body) return null;
  if (body.appearance === "sun") return "sun";
  if (body.appearance === "moon" || body.placement === "satellite" || body.primaryId != null) return "moon";
  if (body.radiusKm == null) return "barycenter";
  return "planet";
}

/** Screen-name group for the viewing center. An unlisted center stays unlabeled by these groups. */
export function centerLabelKind(name: string | null): BodyLabelKind | null {
  if (!name) return null;
  const known = orbitCenter(name);
  const canonical = known?.name ?? name.trim().toUpperCase();
  if (/(?:^| )L[12]$/.test(canonical)) return "lagrange";
  if (canonical.includes("BARYCENTER")) return "barycenter";
  const body = bodyByName(canonical);
  return body ? bodyLabelKind(body.id) : null;
}

/** SANA name for an SPK center. An id outside the catalog stays numeric. */
export function nameForNaif(id: number): string {
  return BY_ID.get(id)?.name ?? `NAIF ${id}`;
}

/** NAIF id for a center the catalog can chain. Unlisted SANA names stay null. */
export function naifForCenter(name: string | null): number | null {
  if (!name) return null;
  const known = orbitCenter(name);
  if (!known) return null;
  return BY_NAME.get(known.name)?.id ?? null;
}

/**
 * Sized bodies drawn around this center. The center body itself is omitted.
 * A center with no NAIF id cannot be chained, so it has no neighbors.
 */
export function neighborsOf(centerName: string | null): readonly BodyRecord[] {
  const id = naifForCenter(centerName);
  if (id == null) return [];
  return BODIES.filter((item) => item.radiusKm != null && item.id !== id);
}
