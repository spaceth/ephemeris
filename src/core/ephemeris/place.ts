/**
 * Which OEM center names have a body in the Earth–Moon–Sun snapshot.
 * Planet names that are only system barycenters in DE440 are not mapped.
 * Drawing Jupiter at barycenter 5 would be a visualization approximation
 * and is not done here.
 */

import { orbitCenter } from "../centers";
import { EARTH, EMB, MOON, SSB, SUN, type NaifId } from "./state";

const NAIF_BY_CENTER: Readonly<Record<string, NaifId>> = {
  EARTH: EARTH,
  MOON: MOON,
  "EARTH BARYCENTER": EMB,
  SUN: SUN,
  "SOLAR SYSTEM BARYCENTER": SSB,
};

export type NeighborBody = {
  id: NaifId;
  name: string;
  radiusKm: number;
};

export function centerNaif(name: string | null): NaifId | null {
  if (!name) return null;
  const known = orbitCenter(name);
  if (!known) return null;
  return NAIF_BY_CENTER[known.name] ?? null;
}

const MOON_BODY: NeighborBody = { id: MOON, name: "Moon", radiusKm: 1737.4 };
const EARTH_BODY: NeighborBody = { id: EARTH, name: "Earth", radiusKm: 6378.137 };
const SUN_BODY: NeighborBody = { id: SUN, name: "Sun", radiusKm: 695700 };

/**
 * Neighbors drawn for a center. The center body itself is never included.
 * The Sun is included for every center the Earth–Moon–Sun snapshot can place.
 */
export function defaultNeighbors(centerName: string | null): readonly NeighborBody[] {
  const id = centerNaif(centerName);
  if (id == null) return [];
  const bodies: NeighborBody[] = [];
  if (id !== SUN) bodies.push(SUN_BODY);
  if (id !== EARTH) bodies.push(EARTH_BODY);
  if (id !== MOON) bodies.push(MOON_BODY);
  return bodies;
}
