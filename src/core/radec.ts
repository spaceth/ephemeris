/**
 * Geocentric right ascension and declination of an EME2000 position.
 * Right ascension is undefined on the celestial pole and at the origin.
 * These angles are geometric: no light-time, aberration, or refraction.
 * The viewer does not plot them yet. stateAt keeps them for a later sky plot.
 */

export function radecEme2000(position: readonly [number, number, number]): {
  raRad: number | null;
  decRad: number;
} {
  const horizontal = Math.hypot(position[0], position[1]);
  const range = Math.hypot(position[0], position[1], position[2]);
  const decRad = Math.atan2(position[2], horizontal);
  if (range < 1e-3 || horizontal <= 1e-8 * Math.max(range, 1)) {
    return { raRad: null, decRad };
  }
  const ra = Math.atan2(position[1], position[0]);
  return { raRad: ra < 0 ? ra + 2 * Math.PI : ra, decRad };
}
