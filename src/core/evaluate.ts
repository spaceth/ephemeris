/**
 * Endpoint rule: a time is evaluable on a segment when it lies in the closed
 * intersection of the usable window (or START/STOP when usable endpoints are
 * absent) and the closed span of that segment's samples. An exact sample
 * epoch inside that interval returns the stored state. A shared instant that
 * falls in more than one segment is ambiguous unless the caller names a
 * segment. Nothing is extrapolated, and segments are never merged.
 */

import { orbitCenter } from "./centers";
import { supportedFrame, sourceToEme2000 } from "./frames";
import { bracketIndex, interpolateComponent } from "./interpolate";
import type { OemFile, OemSegment } from "./oem";
import { radecEme2000 } from "./radec";
import { secondsAtUtcDate } from "./time";
import { failure, type Failure, type Vec3 } from "./types";

export type StateOk = {
  ok: true;
  segmentIndex: number;
  t: number;
  sourceEpoch: string | null;
  positionM: Vec3;
  velocityMps: Vec3;
  /** Center-relative position in EME2000 meters. Geocentric only when the center is Earth. Null outside the frame and center profile. */
  eme2000PositionM: Vec3 | null;
  /** Right ascension of the center-relative EME2000 vector, radians. Null on the celestial pole. */
  raRad: number | null;
  /** Declination of the center-relative EME2000 vector, radians. Null when the position cannot be placed in EME2000. */
  decRad: number | null;
  interpolationLabel: string;
  viewerDefault: boolean;
  exactSample: boolean;
};

export type StateResult = StateOk | Failure;

const EXACT = 1e-9;

export function coverageSpan(oem: OemFile): { start: number; stop: number } | null {
  const ranges = oem.segments.filter((segment) => segment.evalStart != null && segment.evalStop != null);
  if (ranges.length === 0) return null;
  return {
    start: Math.min(...ranges.map((segment) => segment.evalStart as number)),
    stop: Math.max(...ranges.map((segment) => segment.evalStop as number)),
  };
}

/** File-relative seconds of a UTC instant, or null when that instant is outside coverage. */
export function liveSeconds(oem: OemFile, now: Date): number | null {
  if (!oem.origin) return null;
  const span = coverageSpan(oem);
  if (!span) return null;
  let seconds: number;
  try {
    seconds = secondsAtUtcDate(oem.origin, now);
  } catch {
    return null;
  }
  if (seconds < span.start - EXACT || seconds > span.stop + EXACT) return null;
  return seconds;
}

export function covers(segment: OemSegment, t: number): boolean {
  return segment.evalStart != null && segment.evalStop != null && t >= segment.evalStart - EXACT && t <= segment.evalStop + EXACT;
}

/**
 * Segment the clock should show. The current segment stays while it still
 * covers t, including a shared boundary. Otherwise the covering segment that
 * started latest is used. A gap keeps the current segment.
 */
export function segmentAtTime(oem: OemFile, t: number, current: number): number {
  const covering = oem.segments.filter((segment) => covers(segment, t));
  if (covering.some((segment) => segment.index === current)) return current;
  if (covering.length === 0) return oem.segments[current] ? current : 0;
  let chosen = covering[0];
  for (let i = 1; i < covering.length; i += 1) {
    const segment = covering[i];
    const start = segment.evalStart ?? Number.NEGATIVE_INFINITY;
    const chosenStart = chosen.evalStart ?? Number.NEGATIVE_INFINITY;
    if (start > chosenStart || (start === chosenStart && segment.index > chosen.index)) chosen = segment;
  }
  return chosen.index;
}

export function stateAt(oem: OemFile, t: number, segmentIndex?: number): StateResult {
  const span = coverageSpan(oem);
  if (!span || oem.origin == null) {
    return failure("unsupported-time", "This file has no UTC segment that can be placed on a continuous time scale.");
  }
  const covering = oem.segments.filter((segment) => covers(segment, t));
  let segment: OemSegment | undefined;
  if (segmentIndex != null) {
    segment = oem.segments[segmentIndex];
    if (!segment) return failure("outside-coverage", "That segment does not exist.");
    if (!covers(segment, t)) {
      if (t < span.start - EXACT || t > span.stop + EXACT) {
        return failure("outside-coverage", "This epoch is outside the file coverage.");
      }
      if (covering.length === 0) return failure("gap", "No state in coverage at this epoch.");
      return failure("outside-coverage", "The selected segment does not cover this epoch.");
    }
  } else if (covering.length > 1) {
    return failure(
      "ambiguous-segment",
      "This epoch falls in more than one segment. Select a segment before evaluating it.",
    );
  } else if (covering.length === 1) {
    segment = covering[0];
  } else if (t < span.start - EXACT || t > span.stop + EXACT) {
    return failure("outside-coverage", "This epoch is outside the file coverage.");
  } else {
    return failure("gap", "No state in coverage at this epoch.");
  }

  if (segment.timeSystem.toUpperCase() !== "UTC" || segment.evalStart == null) {
    return failure("unsupported-time", `Time system ${segment.timeSystem} cannot be converted for calculation.`);
  }
  const times = segment.samples.map((sample) => sample.t as number);
  const bracket = bracketIndex(times, t);
  if (bracket == null) return failure("outside-coverage", "This epoch is outside the sampled coverage.");
  const exactAt = Math.abs(times[bracket] - t) <= EXACT ? bracket : bracket + 1 < times.length && Math.abs(times[bracket + 1] - t) <= EXACT ? bracket + 1 : -1;
  if (exactAt >= 0) return finish(segment, segment.samples[exactAt].t as number, exactAt, true);

  if (!segment.plan.supported) {
    return failure("unsupported-interpolation", segment.plan.reason ?? "Interpolation is not supported for this segment.");
  }
  if (bracket >= times.length - 1) {
    return failure("outside-coverage", "This epoch is outside the sampled coverage.");
  }
  const positionM: Vec3 = [0, 0, 0];
  const velocityMps: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const values = segment.samples.map((sample) => sample.positionM[axis]);
    const derivs = segment.samples.map((sample) => sample.velocityMps[axis]);
    const got = interpolateComponent(segment.plan, times, values, derivs, bracket, t);
    positionM[axis] = got.p;
    velocityMps[axis] = got.v;
  }
  return finish(segment, t, null, false, positionM, velocityMps);
}

function finish(
  segment: OemSegment,
  t: number,
  sampleIndex: number | null,
  exactSample: boolean,
  positionM?: Vec3,
  velocityMps?: Vec3,
): StateOk {
  const sample = sampleIndex == null ? null : segment.samples[sampleIndex];
  const position = positionM ?? (sample ? sample.positionM : segment.samples[0].positionM);
  const velocity = velocityMps ?? (sample ? sample.velocityMps : segment.samples[0].velocityMps);
  const frame = supportedFrame(segment.refFrame);
  const center = orbitCenter(segment.centerName);
  const eme2000PositionM = frame && center ? sourceToEme2000(frame, position) : null;
  const angles = eme2000PositionM ? radecEme2000(eme2000PositionM) : null;
  return {
    ok: true,
    segmentIndex: segment.index,
    t,
    sourceEpoch: sample?.epochText ?? null,
    positionM: position,
    velocityMps: velocity,
    eme2000PositionM,
    raRad: angles?.raRad ?? null,
    decRad: angles?.decRad ?? null,
    interpolationLabel: segment.plan.label,
    viewerDefault: segment.plan.viewerDefault,
    exactSample,
  };
}
