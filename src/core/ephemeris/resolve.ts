/**
 * Time, frame, and center resolution over SPK sources.
 * Segment search is latest-source, then latest-segment. An unsupported
 * covering segment is a failure. It is not replaced by an older segment.
 * Kilometers become meters once, after the center chain.
 */

import { eme2000ToIcrf, GCRS_TO_EME2000, rotateState, ZERO_RATE } from "../frames";
import type { Vec3 } from "../types";
import { readDouble, readSpkSummaries, readWords, type SpkSegmentSummary } from "./daf";
import { evaluateDiscreteSegment } from "./discrete";
import { evaluateType2, evaluateType3, recordIndex, type EvaluatedKm } from "./spkEval";
import {
  ephemerisFailure,
  NAIF_FRAME_J2000,
  SSB,
  type CartesianState,
  type EphemerisFailure,
  type EphemerisResult,
  type InertialFrame,
  type NaifId,
  type StateQuality,
} from "./state";

const IMPLEMENTED_TYPES = new Set([2, 3, 8, 9, 12, 13]);
const DISCRETE_TYPES = new Set([8, 9, 12, 13]);
const KM_TO_M = 1000;

export type KernelSegment = SpkSegmentSummary & {
  source: number;
};

export type SpkKernel = {
  buffer: ArrayBuffer;
  littleEndian: boolean;
  segments: KernelSegment[];
};

export function openSpk(buffer: ArrayBuffer): SpkKernel {
  const contents = readSpkSummaries(buffer);
  return {
    buffer,
    littleEndian: contents.littleEndian,
    segments: contents.segments.map((segment) => ({ ...segment, source: 0 })),
  };
}

/** Later kernels outrank earlier ones. Segment order inside a kernel is preserved. */
export function loadOrder(buffers: readonly ArrayBuffer[]): SpkKernel[] {
  return buffers.map((buffer, source) => {
    const kernel = openSpk(buffer);
    kernel.segments.forEach((segment) => {
      segment.source = source;
    });
    return kernel;
  });
}

type Directory = {
  init: number;
  intervalLength: number;
  recordSize: number;
  count: number;
  degree: number;
  components: number;
};

function directory(kernel: SpkKernel, segment: KernelSegment): Directory {
  const final = segment.finalAddress;
  const init = readDouble(kernel.buffer, kernel.littleEndian, final - 3);
  const intervalLength = readDouble(kernel.buffer, kernel.littleEndian, final - 2);
  const recordSize = readDouble(kernel.buffer, kernel.littleEndian, final - 1);
  const count = readDouble(kernel.buffer, kernel.littleEndian, final);
  const components = segment.type === 2 ? 3 : 6;
  const degree = (recordSize - 2) / components - 1;
  if (!Number.isInteger(recordSize) || !Number.isInteger(count) || !Number.isInteger(degree) || degree < 0) {
    throw new Error(`SPK type ${segment.type} directory is not a Chebyshev segment`);
  }
  return { init, intervalLength, recordSize, count, degree, components };
}

export function evaluateSegmentKm(kernel: SpkKernel, segment: KernelSegment, et: number): EvaluatedKm {
  if (DISCRETE_TYPES.has(segment.type)) {
    return evaluateDiscreteSegment(kernel.buffer, kernel.littleEndian, segment, et);
  }
  const info = directory(kernel, segment);
  const index = recordIndex(info.init, info.intervalLength, info.count, et);
  const address = segment.initialAddress + index * info.recordSize;
  const words = readWords(kernel.buffer, kernel.littleEndian, address, info.recordSize);
  const record = {
    mid: words[0],
    radius: words[1],
    coefficients: words.subarray(2),
  };
  if (segment.type === 2) return evaluateType2(record, info.degree, et);
  return evaluateType3(record, info.degree, et);
}

function covers(segment: KernelSegment, et: number): boolean {
  return et >= segment.startEt && et <= segment.stopEt;
}

/**
 * Highest-priority segment for `target` at `et`.
 * Returns the failure when that segment cannot be used. Does not continue.
 */
export function selectSegment(
  kernels: readonly SpkKernel[],
  target: NaifId,
  et: number,
): { ok: true; kernel: SpkKernel; segment: KernelSegment } | EphemerisFailure {
  const known = kernels.flatMap((kernel) => kernel.segments.filter((segment) => segment.target === target));
  if (known.length === 0) {
    return ephemerisFailure("missing-dependency", `No SPK segment has target ${target}.`);
  }
  const starts = known.map((segment) => segment.startEt);
  const stops = known.map((segment) => segment.stopEt);
  const spanStart = Math.min(...starts);
  const spanStop = Math.max(...stops);
  for (let source = kernels.length - 1; source >= 0; source -= 1) {
    const kernel = kernels[source];
    for (let index = kernel.segments.length - 1; index >= 0; index -= 1) {
      const segment = kernel.segments[index];
      if (segment.target !== target || !covers(segment, et)) continue;
      if (!IMPLEMENTED_TYPES.has(segment.type)) {
        return ephemerisFailure(
          "unsupported-spk-type",
          `SPK type ${segment.type} for target ${target} is not implemented. An earlier segment was not substituted.`,
        );
      }
      if (segment.frame !== NAIF_FRAME_J2000) {
        return ephemerisFailure(
          "unsupported-frame",
          `NAIF frame ${segment.frame} for target ${target} is not frame 1. Frame 1 on DE440 is ICRF, not dynamical EME2000.`,
        );
      }
      return { ok: true, kernel, segment };
    }
  }
  if (et < spanStart || et > spanStop) {
    return ephemerisFailure("outside-coverage", `Target ${target} is not covered at this TDB epoch.`);
  }
  return ephemerisFailure("gap", `Target ${target} has a coverage gap at this TDB epoch.`);
}

function add(a: Vec3, b: EvaluatedKm, sign: number): void {
  a[0] += sign * b.positionKm[0];
  a[1] += sign * b.positionKm[1];
  a[2] += sign * b.positionKm[2];
}

function addVelocity(a: Vec3, b: EvaluatedKm, sign: number): void {
  a[0] += sign * b.velocityKmps[0];
  a[1] += sign * b.velocityKmps[1];
  a[2] += sign * b.velocityKmps[2];
}

/** Position and velocity of `body` relative to the solar-system barycenter, still in kilometers and ICRF. */
function chainToSsb(
  kernels: readonly SpkKernel[],
  body: NaifId,
  et: number,
): { ok: true; positionKm: Vec3; velocityKmps: Vec3; coverageStart: number; coverageStop: number } | EphemerisFailure {
  if (body === SSB) {
    return { ok: true, positionKm: [0, 0, 0], velocityKmps: [0, 0, 0], coverageStart: -Infinity, coverageStop: Infinity };
  }
  const positionKm: Vec3 = [0, 0, 0];
  const velocityKmps: Vec3 = [0, 0, 0];
  let coverageStart = -Infinity;
  let coverageStop = Infinity;
  const seen = new Set<number>();
  let current = body;
  while (current !== SSB) {
    if (seen.has(current)) {
      return ephemerisFailure("unresolved-center", `Center chain for ${body} repeats body ${current}.`);
    }
    seen.add(current);
    const selected = selectSegment(kernels, current, et);
    if (!("segment" in selected)) return selected;
    let native: EvaluatedKm;
    try {
      native = evaluateSegmentKm(selected.kernel, selected.segment, et);
    } catch (error) {
      const message = error instanceof Error ? error.message : "SPK element could not be read";
      return ephemerisFailure("missing-dependency", message);
    }
    add(positionKm, native, 1);
    addVelocity(velocityKmps, native, 1);
    coverageStart = Math.max(coverageStart, selected.segment.startEt);
    coverageStop = Math.min(coverageStop, selected.segment.stopEt);
    current = selected.segment.center;
  }
  return { ok: true, positionKm, velocityKmps, coverageStart, coverageStop };
}

function toMeters(km: Vec3): Vec3 {
  return [km[0] * KM_TO_M, km[1] * KM_TO_M, km[2] * KM_TO_M];
}

function finishState(
  positionKm: Vec3,
  velocityKmps: Vec3,
  target: NaifId,
  center: NaifId,
  et: number,
  frame: InertialFrame,
  quality: readonly StateQuality[],
  coverageStart: number,
  coverageStop: number,
): EphemerisResult {
  let positionM = toMeters(positionKm);
  let velocityMps = toMeters(velocityKmps);
  let reported: InertialFrame = "ICRF";
  if (frame === "EME2000") {
    const turned = rotateState(GCRS_TO_EME2000, ZERO_RATE, positionM, velocityMps);
    positionM = turned.position;
    velocityMps = turned.velocity;
    reported = "EME2000";
  }
  const state: CartesianState = {
    target,
    center,
    frame: reported,
    positionM,
    velocityMps,
    epoch: { scale: "TDB", secondsPastJ2000: et },
    coverage: { scale: "TDB", startSeconds: coverageStart, stopSeconds: coverageStop },
    quality,
  };
  return { ok: true, state };
}

/** Segment already expressed relative to `center`. No further center is required. */
function stateFromNative(
  kernel: SpkKernel,
  segment: KernelSegment,
  target: NaifId,
  center: NaifId,
  et: number,
  frame: InertialFrame,
  quality: readonly StateQuality[],
): EphemerisResult {
  let native: EvaluatedKm;
  try {
    native = evaluateSegmentKm(kernel, segment, et);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SPK element could not be read";
    return ephemerisFailure("missing-dependency", message);
  }
  return finishState(
    native.positionKm,
    native.velocityKmps,
    target,
    center,
    et,
    frame,
    quality,
    segment.startEt,
    segment.stopEt,
  );
}

/**
 * State of `target` relative to `center` at TDB seconds past J2000.
 * `frame` EME2000 applies the ICRF-to-EME2000 bias once. The bias is constant,
 * so velocity has no rotation-rate term.
 */
export function stateRelative(
  kernels: readonly SpkKernel[],
  target: NaifId,
  center: NaifId,
  et: number,
  frame: InertialFrame,
  quality: readonly StateQuality[] = [{ kind: "native" }],
): EphemerisResult {
  if (!Number.isFinite(et)) return ephemerisFailure("outside-coverage", "The epoch is not a finite TDB time.");
  const selected = selectSegment(kernels, target, et);
  if ("segment" in selected && selected.segment.center === center) {
    return stateFromNative(selected.kernel, selected.segment, target, center, et, frame, quality);
  }
  if (!("segment" in selected) && selected.reason !== "missing-dependency") return selected;
  const targetSsb = chainToSsb(kernels, target, et);
  if (!targetSsb.ok) return targetSsb;
  const centerSsb = chainToSsb(kernels, center, et);
  if (!centerSsb.ok) return centerSsb;
  const positionKm: Vec3 = [
    targetSsb.positionKm[0] - centerSsb.positionKm[0],
    targetSsb.positionKm[1] - centerSsb.positionKm[1],
    targetSsb.positionKm[2] - centerSsb.positionKm[2],
  ];
  const velocityKmps: Vec3 = [
    targetSsb.velocityKmps[0] - centerSsb.velocityKmps[0],
    targetSsb.velocityKmps[1] - centerSsb.velocityKmps[1],
    targetSsb.velocityKmps[2] - centerSsb.velocityKmps[2],
  ];
  const coverageStart = Math.max(targetSsb.coverageStart, centerSsb.coverageStart);
  const coverageStop = Math.min(targetSsb.coverageStop, centerSsb.coverageStop);
  return finishState(positionKm, velocityKmps, target, center, et, frame, quality, coverageStart, coverageStop);
}

/** Round trip helper used by tests that want the bias inverse explicitly. */
export function icrfMetersToEme(positionM: Vec3, velocityMps: Vec3): { position: Vec3; velocity: Vec3 } {
  return rotateState(GCRS_TO_EME2000, ZERO_RATE, positionM, velocityMps);
}

export function emeMetersToIcrf(positionM: Vec3): Vec3 {
  return eme2000ToIcrf(positionM);
}
