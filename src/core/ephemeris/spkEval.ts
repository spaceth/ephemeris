/**
 * SPK segment evaluation for types 2 and 3.
 * Positions come from the Chebyshev value. Type 2 velocity is the analytic
 * derivative scaled by 1/radius (seconds). Type 3 velocity is the stored
 * velocity polynomial, already in kilometers per second.
 */

import { chebyshev } from "./chebyshev";

export type SpkRecord = {
  /** Midpoint, TDB seconds past J2000. */
  mid: number;
  /** Half-length of the interval, seconds. */
  radius: number;
  /** Component-major coefficients: [x..., y..., z...] or six sets for type 3. */
  coefficients: Float64Array;
};

export type EvaluatedKm = {
  positionKm: [number, number, number];
  velocityKmps: [number, number, number];
};

export function evaluateType2(record: SpkRecord, degree: number, et: number): EvaluatedKm {
  const s = (et - record.mid) / record.radius;
  const count = degree + 1;
  const positionKm: [number, number, number] = [0, 0, 0];
  const velocityKmps: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const coeffs = record.coefficients.subarray(axis * count, (axis + 1) * count);
    const got = chebyshev(coeffs, s);
    positionKm[axis] = got.value;
    velocityKmps[axis] = got.derivative / record.radius;
  }
  return { positionKm, velocityKmps };
}

export function evaluateType3(record: SpkRecord, degree: number, et: number): EvaluatedKm {
  const s = (et - record.mid) / record.radius;
  const count = degree + 1;
  const positionKm: [number, number, number] = [0, 0, 0];
  const velocityKmps: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    positionKm[axis] = chebyshev(record.coefficients.subarray(axis * count, (axis + 1) * count), s).value;
    velocityKmps[axis] = chebyshev(record.coefficients.subarray((axis + 3) * count, (axis + 4) * count), s).value;
  }
  return { positionKm, velocityKmps };
}

/** 0-based record index. Both interval endpoints belong to a record; the end clamps to the last. */
export function recordIndex(init: number, intervalLength: number, count: number, et: number): number {
  if (!(count > 0) || !(intervalLength > 0)) return 0;
  let index = Math.floor((et - init) / intervalLength);
  if (index < 0) index = 0;
  if (index >= count) index = count - 1;
  return index;
}
