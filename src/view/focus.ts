import type { Vector3 } from "three";
import type { CameraFocus } from "./camera";

/** Pose the tracking modes read. `body` is a planet, moon, or the center; otherwise the spacecraft. */
export type CameraSubject = {
  ok: boolean;
  pos: Vector3;
  vel: Vector3;
  radiusKm: number;
  body: boolean;
  key: string;
};

export type ScreenPick = {
  focus: CameraFocus;
  /** CSS pixels from the canvas top-left. */
  x: number;
  y: number;
  /** Distance from the camera. The closer body wins when disks overlap. */
  distance: number;
  /** Click radius in CSS pixels. */
  hitPx: number;
  inFront: boolean;
};

/** The screen disk under the pointer. Empty space stays unselected. */
export function chooseFocus(clickX: number, clickY: number, picks: readonly ScreenPick[]): CameraFocus | null {
  let best: ScreenPick | null = null;
  for (const pick of picks) {
    if (!pick.inFront) continue;
    const dx = pick.x - clickX;
    const dy = pick.y - clickY;
    if (dx * dx + dy * dy > pick.hitPx * pick.hitPx) continue;
    if (!best || pick.distance < best.distance) best = pick;
  }
  return best?.focus ?? null;
}
