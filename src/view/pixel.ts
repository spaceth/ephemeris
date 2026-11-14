/** Vertical diameter of a sphere, in CSS pixels. A body around the camera fills the frame. */
export function projectedDiameterPx(fovDeg: number, distance: number, radius: number, heightPx: number): number {
  if (!(radius > 0) || !(heightPx > 0)) return 0;
  if (!(distance > radius)) return heightPx;
  const half = Math.tan((fovDeg * Math.PI) / 360);
  return (radius / distance) / half * heightPx;
}
