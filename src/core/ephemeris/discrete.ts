/**
 * SPK types 8, 9, 12, and 13.
 * Types 8 and 9 interpolate each state component with a Lagrange polynomial.
 * Types 12 and 13 fit a Hermite polynomial to position and velocity and take
 * velocity from that polynomial's derivative. Neither path uses the OEM interpolator.
 *
 * The window is the one in the SPK required reading. For an even window the
 * request time sits between the two central states. A request too close to
 * either end still uses a full window, clamped to the first or last states.
 * An exact state epoch belongs to the later window.
 */

import { readDouble, readWords } from "./daf";
import type { EvaluatedKm } from "./spkEval";

type DiscreteSegment = {
  type: number;
  initialAddress: number;
  finalAddress: number;
};

export function equalLeftIndex(epoch0: number, step: number, count: number, et: number): number {
  if (!(step > 0) || !(count > 0)) return 0;
  let index = Math.floor((et - epoch0) / step);
  if (index < 0) index = 0;
  if (index > count - 1) index = count - 1;
  return index;
}

/** Largest index whose epoch is at or before `et`. */
export function unequalLeftIndex(epochs: ArrayLike<number>, et: number): number {
  let lo = 0;
  let hi = epochs.length - 1;
  if (hi < 0) return 0;
  if (epochs[0] > et) return 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (epochs[mid] <= et) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 0-based start of a window of `window` states. `left` is the state at or before the request. */
export function windowStart(left: number, window: number, count: number): number {
  if (window >= count) return 0;
  let start = left - Math.floor(window / 2) + 1;
  if (start < 0) start = 0;
  const last = count - window;
  if (start > last) start = last;
  return start;
}

/** Barycentric Lagrange. An exact node returns the stored value. */
export function lagrange(times: ArrayLike<number>, values: ArrayLike<number>, at: number): number {
  const n = times.length;
  for (let i = 0; i < n; i += 1) if (at === times[i]) return values[i];
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    let weight = 1;
    const ti = times[i];
    for (let j = 0; j < n; j += 1) if (i !== j) weight *= ti - times[j];
    const term = 1 / (weight * (at - ti));
    num += term * values[i];
    den += term;
  }
  return num / den;
}

/**
 * Newton divided-difference Hermite polynomial.
 * `values[i]` and `rates[i]` are the function and its derivative at `times[i]`.
 */
export function hermite(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  rates: ArrayLike<number>,
  at: number,
): { value: number; derivative: number } {
  const n = times.length;
  for (let i = 0; i < n; i += 1) {
    if (at === times[i]) return { value: values[i], derivative: rates[i] };
  }
  const m = n * 2;
  const z = new Float64Array(m);
  const q = new Float64Array(m * m);
  const atQ = (row: number, col: number) => row * m + col;
  for (let i = 0; i < n; i += 1) {
    z[2 * i] = times[i];
    z[2 * i + 1] = times[i];
    q[atQ(2 * i, 0)] = values[i];
    q[atQ(2 * i + 1, 0)] = values[i];
    q[atQ(2 * i + 1, 1)] = rates[i];
    if (i > 0) {
      q[atQ(2 * i, 1)] = (q[atQ(2 * i, 0)] - q[atQ(2 * i - 1, 0)]) / (z[2 * i] - z[2 * i - 1]);
    }
  }
  for (let row = 2; row < m; row += 1) {
    for (let col = 2; col <= row; col += 1) {
      q[atQ(row, col)] = (q[atQ(row, col - 1)] - q[atQ(row - 1, col - 1)]) / (z[row] - z[row - col]);
    }
  }
  let value = q[atQ(m - 1, m - 1)];
  let derivative = 0;
  for (let i = m - 2; i >= 0; i -= 1) {
    derivative = value + (at - z[i]) * derivative;
    value = q[atQ(i, i)] + (at - z[i]) * value;
  }
  return { value, derivative };
}

type DiscreteKind = "lagrange" | "hermite";

function integerWord(value: number, label: string, min = 1): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || Math.abs(value - rounded) > 1e-6 || rounded < min) {
    throw new Error(`SPK ${label} is not an integer of at least ${min}`);
  }
  return rounded;
}

function readTrailer(
  buffer: ArrayBuffer,
  littleEndian: boolean,
  segment: DiscreteSegment,
): { epoch0: number; step: number; window: number; count: number; degree: number; kind: DiscreteKind; equal: boolean } {
  const final = segment.finalAddress;
  const count = integerWord(readDouble(buffer, littleEndian, final), "state count");
  const third = readDouble(buffer, littleEndian, final - 1);
  const stepOrUnused = readDouble(buffer, littleEndian, final - 2);
  const epoch0 = readDouble(buffer, littleEndian, final - 3);
  if (segment.type === 8 || segment.type === 9) {
    const degree = integerWord(third, "polynomial degree");
    return {
      epoch0,
      step: segment.type === 8 ? stepOrUnused : 0,
      window: degree + 1,
      count,
      degree,
      kind: "lagrange",
      equal: segment.type === 8,
    };
  }
  const window = integerWord(third, "window size minus one", 0) + 1;
  return {
    epoch0,
    step: segment.type === 12 ? stepOrUnused : 0,
    window,
    count,
    degree: 2 * window - 1,
    kind: "hermite",
    equal: segment.type === 12,
  };
}

function component(states: Float64Array, index: number, axis: number): number {
  return states[index * 6 + axis];
}

export function evaluateDiscreteSegment(
  buffer: ArrayBuffer,
  littleEndian: boolean,
  segment: DiscreteSegment,
  et: number,
): EvaluatedKm {
  const info = readTrailer(buffer, littleEndian, segment);
  if (info.count < info.window) {
    throw new Error(`SPK type ${segment.type} has ${info.count} states and needs a window of ${info.window}`);
  }
  if (info.equal && !(info.step > 0)) throw new Error(`SPK type ${segment.type} step is not positive`);
  const states = readWords(buffer, littleEndian, segment.initialAddress, info.count * 6);
  let epochs: Float64Array | null = null;
  if (!info.equal) {
    epochs = readWords(buffer, littleEndian, segment.initialAddress + info.count * 6, info.count);
  }
  const left = info.equal || !epochs
    ? equalLeftIndex(info.epoch0, info.step, info.count, et)
    : unequalLeftIndex(epochs, et);
  const start = windowStart(left, info.window, info.count);
  const times = new Float64Array(info.window);
  for (let i = 0; i < info.window; i += 1) {
    times[i] = info.equal ? info.epoch0 + (start + i) * info.step : (epochs as Float64Array)[start + i];
  }
  const positionKm: [number, number, number] = [0, 0, 0];
  const velocityKmps: [number, number, number] = [0, 0, 0];
  const samples = new Float64Array(info.window);
  const rates = new Float64Array(info.window);
  for (let axis = 0; axis < 3; axis += 1) {
    for (let i = 0; i < info.window; i += 1) samples[i] = component(states, start + i, axis);
    if (info.kind === "lagrange") {
      positionKm[axis] = lagrange(times, samples, et);
    } else {
      for (let i = 0; i < info.window; i += 1) rates[i] = component(states, start + i, axis + 3);
      const fit = hermite(times, samples, rates, et);
      positionKm[axis] = fit.value;
      velocityKmps[axis] = fit.derivative;
    }
  }
  if (info.kind === "lagrange") {
    for (let axis = 0; axis < 3; axis += 1) {
      for (let i = 0; i < info.window; i += 1) samples[i] = component(states, start + i, axis + 3);
      velocityKmps[axis] = lagrange(times, samples, et);
    }
  }
  return { positionKm, velocityKmps };
}
