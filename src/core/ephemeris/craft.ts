/**
 * A spacecraft SPK opened as a viewer file.
 * Evaluation uses the SPK segment, not the OEM interpolator.
 * A segment whose center is the scene center does not need the planetary snapshot.
 * An unsupported type or frame stays in the segment list and is not drawn.
 */

import type { OemFile, OemSegment } from "../oem";
import { DAYSEC, formatTaiSeconds, type TaiOrigin } from "../time";
import type { InterpPlan } from "../interpolate";
import { stateAt, type StateOk, type StateResult } from "../evaluate";
import { failure } from "../types";
import type { ArcBuffer } from "../../session";
import { readDouble } from "./daf";
import { nameForNaif } from "./bodies";
import { openSpk, stateRelative, type SpkKernel } from "./resolve";
import { J2000_JD, tdbFromTaiClock, TT_MINUS_TAI_SECONDS } from "./scales";
import { NAIF_FRAME_J2000, type StateQuality } from "./state";
import type { SpkSegmentSummary } from "./daf";

const SUPPORTED_TYPES = new Set([2, 3, 8, 9, 12, 13]);
const CHORD_M = 1500;
const MAX_DEPTH = 8;
const ARC_CAP = 20000;
const BOUNDARY_GAP_S = 1e-6;
const HANDOFF_M = 1;

const QUALITY: StateQuality[] = [
  { kind: "native" },
  { kind: "approximate", reason: "tdb-equals-tt" },
];

export type CraftWindow = {
  oemIndex: number;
  target: number;
  center: number;
  spkIndex: number;
  startEt: number;
  stopEt: number;
  step: number;
  type: number;
  frame: number;
  supported: boolean;
  reason: string | null;
};

type Binding = { kernel: SpkKernel; windows: CraftWindow[] };

const bindings = new WeakMap<OemFile, Binding>();

type Range = { start: number; stop: number };

function centerName(id: number): string {
  return nameForNaif(id);
}

function originAt(et: number): TaiOrigin {
  return { tai1: J2000_JD, tai2: (et - TT_MINUS_TAI_SECONDS) / DAYSEC };
}

function epochText(origin: TaiOrigin, seconds: number): string | null {
  try {
    return formatTaiSeconds(origin, seconds, 3).text;
  } catch {
    return null;
  }
}

function degreeOf(kernel: SpkKernel, segment: SpkSegmentSummary): number | null {
  try {
    const marker = readDouble(kernel.buffer, kernel.littleEndian, segment.finalAddress - 1);
    if (segment.type === 8 || segment.type === 9) return Math.round(marker);
    if (segment.type === 12 || segment.type === 13) return 2 * (Math.round(marker) + 1) - 1;
  } catch {
    return null;
  }
  return null;
}

function stepOf(kernel: SpkKernel, segment: SpkSegmentSummary): number {
  const span = Math.max(segment.stopEt - segment.startEt, 1);
  try {
    if (segment.type === 8 || segment.type === 12 || segment.type === 2 || segment.type === 3) {
      const step = readDouble(kernel.buffer, kernel.littleEndian, segment.finalAddress - 2);
      return step > 0 ? step : span;
    }
  } catch {
    return span / 32;
  }
  return span / 32;
}

function subtract(piece: Range, taken: Range): Range[] {
  if (piece.stop < taken.start || piece.start > taken.stop) return [piece];
  const out: Range[] = [];
  if (piece.start < taken.start - BOUNDARY_GAP_S) {
    out.push({ start: piece.start, stop: taken.start - BOUNDARY_GAP_S });
  }
  if (piece.stop > taken.stop + BOUNDARY_GAP_S) {
    out.push({ start: taken.stop + BOUNDARY_GAP_S, stop: piece.stop });
  }
  return out;
}

function windowsFor(kernel: SpkKernel): CraftWindow[] {
  const claimedByTarget = new Map<number, Range[]>();
  const pieces: CraftWindow[] = [];
  const segments = [...kernel.segments].sort((a, b) => b.index - a.index);
  for (const segment of segments) {
    const supported = SUPPORTED_TYPES.has(segment.type) && segment.frame === NAIF_FRAME_J2000;
    let reason: string | null = null;
    if (!SUPPORTED_TYPES.has(segment.type)) {
      reason = `SPK type ${segment.type} is not implemented. An earlier segment was not substituted.`;
    } else if (segment.frame !== NAIF_FRAME_J2000) {
      reason = `NAIF frame ${segment.frame} is not frame 1.`;
    }
    const claimed = claimedByTarget.get(segment.target) ?? [];
    let free: Range[] = [{ start: segment.startEt, stop: segment.stopEt }];
    for (const taken of claimed) {
      free = free.flatMap((piece) => subtract(piece, taken));
    }
    for (const range of free) {
      if (range.stop - range.start < BOUNDARY_GAP_S) continue;
      pieces.push({
        oemIndex: 0,
        target: segment.target,
        center: segment.center,
        spkIndex: segment.index,
        startEt: range.start,
        stopEt: range.stop,
        step: stepOf(kernel, segment),
        type: segment.type,
        frame: segment.frame,
        supported,
        reason,
      });
    }
    claimed.push({ start: segment.startEt, stop: segment.stopEt });
    claimedByTarget.set(segment.target, claimed);
  }
  pieces.sort((a, b) => a.startEt - b.startEt || a.spkIndex - b.spkIndex);
  pieces.forEach((piece, index) => {
    piece.oemIndex = index;
  });
  return pieces;
}

function planFor(window: CraftWindow, degree: number | null): InterpPlan {
  const hermite = window.type === 12 || window.type === 13;
  return {
    kind: hermite ? "hermite" : "lagrange",
    degree: degree ?? (hermite ? 3 : 1),
    nodes: degree != null && hermite ? (degree + 1) / 2 : (degree ?? 1) + 1,
    viewerDefault: false,
    label: `SPK type ${window.type}`,
    supported: false,
    reason: window.reason,
  };
}

function segmentFor(window: CraftWindow, origin: TaiOrigin, originEt: number, degree: number | null): OemSegment {
  const start = window.startEt - originEt;
  const stop = window.stopEt - originEt;
  return {
    index: window.oemIndex,
    objectName: `NAIF ${window.target}`,
    objectId: String(window.target),
    centerName: centerName(window.center),
    refFrame: window.frame === NAIF_FRAME_J2000 ? "EME2000" : `NAIF ${window.frame}`,
    refFrameEpoch: null,
    timeSystem: "TDB",
    startTime: epochText(origin, start),
    stopTime: epochText(origin, stop),
    usableStart: null,
    usableStop: null,
    interpolationMethod: `SPK type ${window.type}`,
    interpolationDegree: degree,
    plan: planFor(window, degree),
    samples: [],
    evalStart: start,
    evalStop: stop,
    calculationSupported: window.supported,
    unsupportedReason: window.reason,
    comments: ["States come from the SPK evaluator. They are not OEM samples."],
  };
}

function describe(buffer: ArrayBuffer): { file: OemFile; kernel: SpkKernel; windows: CraftWindow[] } {
  const kernel = openSpk(buffer);
  if (kernel.segments.length === 0) throw new Error("This SPK has no segments.");
  const windows = windowsFor(kernel);
  if (windows.length === 0) throw new Error("This SPK has no coverage to evaluate.");
  const originEt = Math.min(...windows.map((window) => window.startEt));
  const origin = originAt(originEt);
  const degrees = new Map(kernel.segments.map((segment) => [segment.index, degreeOf(kernel, segment)]));
  const file: OemFile = {
    version: "SPK",
    creationDate: null,
    originator: null,
    messageId: null,
    comments: [
      "TDB is taken equal to TT. The clock is TAI seconds from the first coverage instant.",
      "NAIF frame 1 is ICRF. EME2000 applies that bias once.",
    ],
    segments: windows.map((window) => segmentFor(window, origin, originEt, degrees.get(window.spkIndex) ?? null)),
    covariances: [],
    warnings: windows.filter((window) => !window.supported).map((window) => window.reason ?? "Unsupported SPK segment"),
    origin,
    format: "spk",
  };
  return { file, kernel, windows };
}

type Knot = { t: number; x: number; y: number; z: number };

function place(kernel: SpkKernel, window: CraftWindow, originEt: number, fileSeconds: number): Knot | null {
  const state = stateRelative([kernel], window.target, window.center, originEt + fileSeconds, "EME2000", QUALITY);
  if (!state.ok) return null;
  const [x, y, z] = state.state.positionM;
  return { t: fileSeconds, x, y, z };
}

function chord(a: Knot, b: Knot, p: Knot): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-12) return Math.hypot(apx, apy, apz);
  const u = Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / ab2));
  return Math.hypot(apx - abx * u, apy - aby * u, apz - abz * u);
}

function emit(a: Knot, b: Knot, at: (t: number) => Knot | null, out: Knot[], depth: number) {
  const room = out.length < ARC_CAP - 1;
  const mid = room && depth < MAX_DEPTH && b.t - a.t > 1 ? at((a.t + b.t) / 2) : null;
  if (mid && chord(a, b, mid) > CHORD_M) {
    emit(a, mid, at, out, depth + 1);
    emit(mid, b, at, out, depth + 1);
    return;
  }
  out.push(b);
}

function arcFor(kernel: SpkKernel, window: CraftWindow, originEt: number): ArcBuffer | null {
  if (!window.supported) return null;
  const start = window.startEt - originEt;
  const stop = window.stopEt - originEt;
  const span = stop - start;
  const step = Math.min(Math.max(window.step, span / 256), Math.max(span, 1));
  const seeds = [start];
  for (let t = start + step; t < stop; t += step) seeds.push(t);
  if (seeds[seeds.length - 1] !== stop) seeds.push(stop);
  const at = (t: number) => place(kernel, window, originEt, t);
  const knots: Knot[] = [];
  const first = at(seeds[0]);
  if (!first) return null;
  knots.push(first);
  for (let i = 1; i < seeds.length; i += 1) {
    const next = at(seeds[i]);
    if (!next) continue;
    emit(knots[knots.length - 1], next, at, knots, 0);
  }
  if (knots.length < 2) return null;
  return {
    segmentIndex: window.oemIndex,
    positions: Float32Array.from(knots.flatMap((knot) => [knot.x, knot.y, knot.z])),
    times: Float32Array.from(knots.map((knot) => knot.t)),
  };
}

function continuous(left: ArcBuffer, right: ArcBuffer): boolean {
  const lt = left.times[left.times.length - 1];
  const rt = right.times[0];
  if (rt - lt > 1) return false;
  const n = left.positions.length;
  const dx = left.positions[n - 3] - right.positions[0];
  const dy = left.positions[n - 2] - right.positions[1];
  const dz = left.positions[n - 1] - right.positions[2];
  return Math.hypot(dx, dy, dz) <= HANDOFF_M;
}

function mergeCenter(arcs: ArcBuffer[]): ArcBuffer[] {
  const ordered = [...arcs].sort((a, b) => a.times[0] - b.times[0]);
  const out: ArcBuffer[] = [];
  for (const arc of ordered) {
    const prev = out[out.length - 1];
    if (!prev || !continuous(prev, arc)) {
      out.push(arc);
      continue;
    }
    const positions = new Float32Array(prev.positions.length + arc.positions.length - 3);
    const times = new Float32Array(prev.times.length + arc.times.length - 1);
    positions.set(prev.positions, 0);
    positions.set(arc.positions.subarray(3), prev.positions.length);
    times.set(prev.times, 0);
    times.set(arc.times.subarray(1), prev.times.length);
    prev.positions = positions;
    prev.times = times;
  }
  return out;
}

/** Parse an SPK into the viewer file and center-relative arcs. */
export function craftSession(buffer: ArrayBuffer): { file: OemFile; arcs: ArcBuffer[] } {
  const described = describe(buffer);
  const originEt = described.windows[0] ? Math.min(...described.windows.map((window) => window.startEt)) : 0;
  const byCenter = new Map<number, ArcBuffer[]>();
  for (const window of described.windows) {
    const arc = arcFor(described.kernel, window, originEt);
    if (!arc) continue;
    const list = byCenter.get(window.center) ?? [];
    list.push(arc);
    byCenter.set(window.center, list);
  }
  const arcs = [...byCenter.values()].flatMap((group) => mergeCenter(group));
  return { file: described.file, arcs };
}

/** Remember the kernel for a file the worker already parsed. */
export function bindCraft(file: OemFile, buffer: ArrayBuffer): void {
  const described = describe(buffer);
  bindings.set(file, { kernel: described.kernel, windows: described.windows });
}

export function craftBound(file: OemFile): boolean {
  return bindings.has(file);
}

/** OEM files use `stateAt`. An opened SPK uses the segment evaluator. */
export function displayedState(file: OemFile, t: number, segmentIndex?: number): StateResult {
  const binding = bindings.get(file);
  if (!binding) return stateAt(file, t, segmentIndex);
  if (!file.origin) return failure("unsupported-time", "This SPK is not available to evaluate.");
  const index = segmentIndex ?? 0;
  const window = binding.windows.find((item) => item.oemIndex === index);
  if (!window) return failure("outside-coverage", "That segment does not exist.");
  if (!window.supported) {
    const reason = SUPPORTED_TYPES.has(window.type) ? "unsupported-frame" : "unsupported-interpolation";
    return failure(reason, window.reason ?? "This SPK segment cannot be evaluated.");
  }
  const et = tdbFromTaiClock(file.origin, t).secondsPastJ2000;
  if (et < window.startEt - 1e-6 || et > window.stopEt + 1e-6) {
    return failure("outside-coverage", "The selected segment does not cover this epoch.");
  }
  const state = stateRelative([binding.kernel], window.target, window.center, et, "EME2000", QUALITY);
  if (!state.ok) return failure(state.reason === "gap" ? "gap" : "outside-coverage", state.message);
  const result: StateOk = {
    ok: true,
    segmentIndex: window.oemIndex,
    t,
    sourceEpoch: null,
    positionM: state.state.positionM,
    velocityMps: state.state.velocityMps,
    eme2000PositionM: state.state.positionM,
    raRad: null,
    decRad: null,
    interpolationLabel: `SPK type ${window.type}`,
    viewerDefault: false,
    exactSample: false,
  };
  return result;
}
