/**
 * Sun direction from the planetary snapshot, in scene axes.
 * Null means the snapshot cannot place the Sun relative to that body,
 * and the caller keeps the analytic direction.
 */

import type { TaiOrigin } from "../time";
import { toScene } from "../scene";
import { stateRelative, type SpkKernel } from "./resolve";
import { tdbFromTaiClock } from "./scales";
import { SUN, type NaifId, type StateQuality } from "./state";

let kernel: SpkKernel | null = null;

export function setLightingKernel(next: SpkKernel | null): void {
  kernel = next;
}

export function lightingKernel(): SpkKernel | null {
  return kernel;
}

export function ephemerisSunScene(
  body: NaifId,
  origin: TaiOrigin,
  taiSeconds: number,
): [number, number, number] | null {
  if (!kernel || body === SUN) return null;
  const converted = tdbFromTaiClock(origin, taiSeconds);
  const quality: StateQuality[] = [{ kind: "native" }, converted.quality];
  const state = stateRelative([kernel], SUN, body, converted.secondsPastJ2000, "EME2000", quality);
  if (!state.ok) return null;
  const [x, y, z] = toScene(state.state.positionM[0], state.state.positionM[1], state.state.positionM[2]);
  const scale = Math.hypot(x, y, z);
  if (!(scale > 0)) return null;
  return [x / scale, y / scale, z / scale];
}
