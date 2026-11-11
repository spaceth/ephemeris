/**
 * Canonical inertial axes for the OEM viewer and the scene are EME2000:
 * the dynamical mean equator and equinox of J2000.0.
 *
 * OEM `EME2000` is already those axes and is not rotated.
 * OEM `GCRF` and `ICRF` are the GCRS/ICRS axis set. `sourceToEme2000` is
 * the only OEM site that multiplies by `GCRS_TO_EME2000`. `toScene` does
 * not apply the bias again.
 *
 * NAIF frame id 1 on the supported DE440 kernel is ICRF, even though the
 * product is labeled J2000. It is not dynamical EME2000. Chebyshev
 * evaluation leaves those vectors in ICRF. `icrfToEme2000` applies the
 * same matrix once when a caller asks for EME2000.
 *
 * Treating an ICRF barycentric vector and a GCRS geocentric vector as the
 * same axes is a visualization convention, not a relativistic
 * BCRS-to-GCRS reduction.
 *
 * The bias was evaluated from the ERFA pfw06/fw2m chain and stored here so
 * the nutation series is not needed to apply it.
 */

export type SupportedFrame = "EME2000" | "GCRF" | "ICRF";

/** Maps a GCRS column vector into EME2000. Row-major. */
export const GCRS_TO_EME2000: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] = [
  [9.999999999999941158e-1, -7.078368960971556128e-8, 8.056213977613186084e-8],
  [7.078368694637676268e-8, 9.999999999999968914e-1, 3.305943735432137487e-8],
  [-8.056214211620057482e-8, -3.305943169218394928e-8, 9.999999999999962252e-1],
];

export function supportedFrame(name: string): SupportedFrame | null {
  const key = name.trim().toUpperCase();
  if (key === "EME2000") return "EME2000";
  if (key === "GCRF") return "GCRF";
  if (key === "ICRF") return "ICRF";
  return null;
}

type RowMajor = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

function apply(r: RowMajor, position: readonly [number, number, number]): [number, number, number] {
  return [
    r[0][0] * position[0] + r[0][1] * position[1] + r[0][2] * position[2],
    r[1][0] * position[0] + r[1][1] * position[1] + r[1][2] * position[2],
    r[2][0] * position[0] + r[2][1] * position[1] + r[2][2] * position[2],
  ];
}

/** Inverse of `GCRS_TO_EME2000`. A rotation, so the inverse is the transpose. */
export const EME2000_TO_GCRS: RowMajor = [
  [GCRS_TO_EME2000[0][0], GCRS_TO_EME2000[1][0], GCRS_TO_EME2000[2][0]],
  [GCRS_TO_EME2000[0][1], GCRS_TO_EME2000[1][1], GCRS_TO_EME2000[2][1]],
  [GCRS_TO_EME2000[0][2], GCRS_TO_EME2000[1][2], GCRS_TO_EME2000[2][2]],
];

/** Position in the source frame, meters, expressed in EME2000. The origin is unchanged. */
export function sourceToEme2000(
  frame: SupportedFrame,
  position: readonly [number, number, number],
): [number, number, number] {
  if (frame === "EME2000") return [position[0], position[1], position[2]];
  return apply(GCRS_TO_EME2000, position);
}

/**
 * One application of the frame bias for a DE440 / NAIF frame-1 vector.
 * Do not call this on a vector that `sourceToEme2000` has already rotated.
 */
export function icrfToEme2000(position: readonly [number, number, number]): [number, number, number] {
  return apply(GCRS_TO_EME2000, position);
}

/** Inverse bias. EME2000 column vector into the ICRF / GCRS axis set. */
export function eme2000ToIcrf(position: readonly [number, number, number]): [number, number, number] {
  return apply(EME2000_TO_GCRS, position);
}

/**
 * Constant or time-dependent frame rotation of a Cartesian state.
 * `rate` is dR/dt in the same row-major layout. A frozen bias passes a zero
 * rate, so velocity is only rotated. A time-dependent matrix must pass its
 * derivative: v_out = R v + (dR/dt) r.
 */
export function rotateState(
  rotation: RowMajor,
  rate: RowMajor,
  position: readonly [number, number, number],
  velocity: readonly [number, number, number],
): { position: [number, number, number]; velocity: [number, number, number] } {
  const turned = apply(rotation, position);
  const rotatedVelocity = apply(rotation, velocity);
  const rateTerm = apply(rate, position);
  return {
    position: turned,
    velocity: [
      rotatedVelocity[0] + rateTerm[0],
      rotatedVelocity[1] + rateTerm[1],
      rotatedVelocity[2] + rateTerm[2],
    ],
  };
}

/** Row-major zero matrix, for a constant rotation. */
export const ZERO_RATE: RowMajor = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];
