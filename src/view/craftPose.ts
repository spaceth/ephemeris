import { displayedState } from "../core/ephemeris/craft";
import { sourceToEme2000, supportedFrame } from "../core/frames";
import { toScene } from "../core/scene";
import type { SceneClock } from "./types";
import type { Vector3 } from "three";

export type CraftPose = {
  ok: boolean;
  pos: Vector3;
  vel: Vector3;
};

/**
 * One evaluation of the spacecraft, written into the shared pose.
 * `vel` is the EME2000 velocity in scene axes. The follow camera may use it
 * as an offset. It is not spacecraft attitude. No attitude quaternion is
 * applied; the marker stays a screen-space point.
 */
export function readCraft(clock: { current: SceneClock }, pose: CraftPose): boolean {
  const file = clock.current.file;
  if (!file) {
    pose.ok = false;
    return false;
  }
  const state = displayedState(file, clock.current.t, clock.current.segment);
  if (!state.ok || !state.eme2000PositionM) {
    pose.ok = false;
    return false;
  }
  const scene = toScene(state.eme2000PositionM[0], state.eme2000PositionM[1], state.eme2000PositionM[2]);
  pose.pos.set(scene[0], scene[1], scene[2]);
  const segment = file.segments[state.segmentIndex];
  const frame = segment ? supportedFrame(segment.refFrame) : null;
  const eme = frame ? sourceToEme2000(frame, state.velocityMps) : state.velocityMps;
  const sceneVel = toScene(eme[0], eme[1], eme[2]);
  pose.vel.set(sceneVel[0], sceneVel[1], sceneVel[2]);
  pose.ok = true;
  return true;
}
