/** Vertical diameter of a sphere, in CSS pixels. A body around the camera fills the frame. */
export function projectedDiameterPx(fovDeg: number, distance: number, radius: number, heightPx: number): number {
  if (!(radius > 0) || !(heightPx > 0)) return 0;
  if (!(distance > radius)) return heightPx;
  const half = Math.tan((fovDeg * Math.PI) / 360);
  return (radius / distance) / half * heightPx;
}

/**
 * A planet has almost disappeared at this on-screen diameter, the same point
 * the sphere gives way to a dot. Its orbit line is fully drawn there.
 */
export const PLANET_ORBIT_FULL_PX = 1;

/**
 * The orbit line stays fully hidden until the planet is down to this size.
 * That is well past a close view, so the line only starts to appear once the
 * zoom has pulled much further out.
 */
export const PLANET_ORBIT_HIDDEN_PX = 8;

/**
 * Opacity of one planet's orbit line from that planet's on-screen diameter.
 * Zoomed in, the coarse ring fades to 0. Zoomed out, it returns to 1 once the
 * planet has almost disappeared. The line stays in the scene and only fades.
 */
export function planetOrbitOpacity(diameterPx: number): number {
  if (!(diameterPx > PLANET_ORBIT_FULL_PX)) return 1;
  if (diameterPx >= PLANET_ORBIT_HIDDEN_PX) return 0;
  const span = PLANET_ORBIT_HIDDEN_PX - PLANET_ORBIT_FULL_PX;
  const t = (diameterPx - PLANET_ORBIT_FULL_PX) / span;
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}
