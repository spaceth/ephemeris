/**
 * Reserved spacecraft attitude. No AEM is parsed and no interpolator is chosen.
 * A future message has to be inspected for its representation, frames, rates,
 * and quaternion continuity before an interpolation method is selected.
 *
 * The quaternion is scalar-last. It rotates body-fixed vectors into EME2000:
 * v_eme = q v_body q⁻¹. Nothing in the viewer returns one today.
 * The craft marker stays a screen-space point. Velocity used by the follow
 * camera is a camera offset, not spacecraft attitude.
 */

export type AttitudeQuaternion = {
  x: number;
  y: number;
  z: number;
  /** Scalar part. */
  w: number;
};

export type BodyAttitude = {
  frame: "EME2000";
  quaternion: AttitudeQuaternion;
};

/** No attitude ephemeris is loaded. */
export function attitudeAt(): BodyAttitude | null {
  return null;
}
