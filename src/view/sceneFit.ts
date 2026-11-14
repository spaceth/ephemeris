import type { ArcBuffer } from "../session";

/** Camera distance that keeps the widest arc on screen, in scene kilometers. Arc positions are EME2000 meters. */
export function trajectoryRadius(arcs: ArcBuffer[]): number {
  let radius = 12;
  for (const arc of arcs) {
    const values = arc.positions;
    for (let i = 0; i < values.length; i += 3) {
      const reach = Math.hypot(values[i], values[i + 1], values[i + 2]) * 1e-3;
      if (reach > radius) radius = reach;
    }
  }
  return radius;
}
