/**
 * Lazy load of the committed Earth–Moon–Sun snapshot.
 * A failed fetch leaves planetary placement off. An OEM whose center is
 * already the scene origin still draws.
 */

import { openSpk, type SpkKernel } from "./resolve";

export const PLANETARY_SNAPSHOT = "/ephemeris/de440-earth-moon-sun.bsp";

let pending: Promise<SpkKernel | null> | null = null;

export function loadPlanetarySnapshot(fetchImpl: typeof fetch = fetch): Promise<SpkKernel | null> {
  if (!pending) {
    pending = fetchImpl(PLANETARY_SNAPSHOT)
      .then(async (response) => {
        if (!response.ok) return null;
        return openSpk(await response.arrayBuffer());
      })
      .catch(() => null);
  }
  return pending;
}

/** Test hook. The page loads the snapshot once. */
export function resetPlanetarySnapshot(): void {
  pending = null;
}
