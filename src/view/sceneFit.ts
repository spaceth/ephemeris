import type { ArcBuffer } from "../session";

/** Camera distance that keeps the widest arc on screen, in scene kilometers. */
export function trajectoryRadius(arcs: ArcBuffer[]): number {
  let radius = 12;
  for (const arc of arcs) {
    const values = arc.positions;
    for (let i = 0; i < values.length; i += 3) {
      const reach = Math.hypot(values[i], values[i + 1], values[i + 2]);
      if (reach > radius) radius = reach;
    }
  }
  return radius;
}
