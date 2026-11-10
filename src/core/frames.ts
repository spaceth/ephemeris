/**
 * EME2000 is the working frame. GCRF is treated as GCRS and rotated by the
 * IAU 2006 frame bias frozen at J2000.0. The bias was evaluated from the
 * ERFA pfw06/fw2m chain and stored here so the nutation series is not needed
 * at runtime.
 */

export type SupportedFrame = "EME2000" | "GCRF";

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
  return null;
}

/** Position in the source frame, meters, expressed in EME2000. */
export function sourceToEme2000(
  frame: SupportedFrame,
  position: readonly [number, number, number],
): [number, number, number] {
  if (frame === "EME2000") return [position[0], position[1], position[2]];
  const r = GCRS_TO_EME2000;
  return [
    r[0][0] * position[0] + r[0][1] * position[1] + r[0][2] * position[2],
    r[1][0] * position[0] + r[1][1] * position[1] + r[1][2] * position[2],
    r[2][0] * position[0] + r[2][1] * position[1] + r[2][2] * position[2],
  ];
}
