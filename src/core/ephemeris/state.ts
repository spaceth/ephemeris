/**
 * Application state contract for ephemeris products.
 * OEM `StateOk` stays the OEM path. This type is the SPK and planetary API.
 *
 * Units at this boundary are meters and meters per second. A reader that
 * stores kilometers converts once, here, and not again.
 * NAIF ids stay numeric: 3 is the Earth–Moon barycenter, 399 is Earth,
 * 5 is the Jupiter system barycenter, 599 is Jupiter. Drawing a body at
 * its system barycenter is a visualization approximation, not an identity
 * of those ids.
 */

import type { Vec3 } from "../types";

export type NaifId = number;

/** Inertial axes carried on a state. EME2000 is the dynamical mean equator of J2000.0. */
export type InertialFrame = "EME2000" | "ICRF";

export type TimeScale = "TAI" | "TT" | "TDB" | "UTC";

/**
 * An instant on a named scale.
 * `secondsPastJ2000` is seconds past JD 2451545.0 (12:00 on that scale).
 */
export type Epoch = {
  scale: TimeScale;
  secondsPastJ2000: number;
};

/** Closed coverage window. `startSeconds` and `stopSeconds` use `scale`. */
export type Coverage = {
  scale: "TAI" | "TDB";
  startSeconds: number;
  stopSeconds: number;
};

export type StateQuality =
  | { kind: "native" }
  | { kind: "approximate"; reason: "tdb-equals-tt" | "barycenter-drawn-as-body" | "barycenter-circle" | "shared-inertial-axes" }
  | { kind: "reconstructed"; reason: "emrat-earth" };

export type CartesianState = {
  target: NaifId;
  center: NaifId;
  frame: InertialFrame;
  positionM: Vec3;
  velocityMps: Vec3;
  epoch: Epoch;
  coverage: Coverage;
  quality: readonly StateQuality[];
};

export type EphemerisFailReason =
  | "outside-coverage"
  | "gap"
  | "unresolved-center"
  | "missing-dependency"
  | "unsupported-frame"
  | "unsupported-spk-type";

export type EphemerisFailure = {
  ok: false;
  reason: EphemerisFailReason;
  message: string;
};

export type EphemerisResult = { ok: true; state: CartesianState } | EphemerisFailure;

export function ephemerisFailure(reason: EphemerisFailReason, message: string): EphemerisFailure {
  return { ok: false, reason, message };
}

/** Solar-system barycenter. SPK center 0 has no parent. */
export const SSB: NaifId = 0;
/** Earth–Moon barycenter. Not Earth. */
export const EMB: NaifId = 3;
export const MOON: NaifId = 301;
export const EARTH: NaifId = 399;
export const SUN: NaifId = 10;

/** NAIF frame id 1 on the supported DE440 kernel. Those vectors are ICRF, not dynamical EME2000. */
export const NAIF_FRAME_J2000 = 1;
