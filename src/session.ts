import { centerKey, orbitCenter } from "./core/centers";
import { sourceToEme2000, supportedFrame } from "./core/frames";
import type { SupportedFrame } from "./core/frames";
import { bracketIndex, interpolateComponent } from "./core/interpolate";
import type { InterpPlan } from "./core/interpolate";
import type { OemFile, OemSegment } from "./core/oem";
import { toScene } from "./core/scene";
import type { Vec3 } from "./core/types";

export type ArcBuffer = {
  segmentIndex: number;
  positions: Float32Array;
  /** Seconds from the file origin, one per vertex, so a trail can end at the clock. */
  times: Float32Array;
};

export type WorkerRequest =
  | { type: "parse"; id: number; text: string; name: string }
  | { type: "parse-spk"; id: number; name: string; buffer: ArrayBuffer };

export type WorkerResponse =
  | { type: "parsed"; id: number; name: string; file: OemFile; arcs: ArcBuffer[] }
  | { type: "parse-error"; id: number; message: string };

/** Stop refining once a chord sits this close to the interpolant, in scene kilometers. */
const CHORD_KM = 1.5;
const MAX_DEPTH = 8;
const ARC_CAP = 80000;

type Knot = { t: number; x: number; y: number; z: number };

type Curve = {
  plan: InterpPlan;
  frame: SupportedFrame;
  times: number[];
  pos: [number[], number[], number[]];
  vel: [number[], number[], number[]];
};

function sameCenter(a: string, b: string): boolean {
  const left = orbitCenter(a);
  const right = orbitCenter(b);
  if (left && right) return left.name === right.name;
  return centerKey(a) === centerKey(b);
}

/** Arcs that share the selected segment's center. Different centers are different origins and are not drawn together. */
export function arcsForCenter(file: OemFile, arcs: ArcBuffer[], segmentIndex: number): ArcBuffer[] {
  const selected = file.segments[segmentIndex];
  if (!selected) return [];
  return arcs.filter((arc) => {
    const segment = file.segments[arc.segmentIndex];
    return segment != null && sameCenter(segment.centerName, selected.centerName);
  });
}

/** One scene polyline per segment, in center-relative EME2000 kilometers. Samples are refined with the segment interpolant so a close view does not show the chords. */
export function buildArcs(file: OemFile): ArcBuffer[] {
  const arcs: ArcBuffer[] = [];
  for (const segment of file.segments) {
    const frame = supportedFrame(segment.refFrame);
    if (!frame || !orbitCenter(segment.centerName)) continue;
    if (segment.evalStart == null || segment.evalStop == null) continue;
    const knots = usableKnots(segment, frame);
    if (knots.length < 2) continue;
    const line = segment.plan.supported && segment.plan.kind !== "linear"
      ? refine(knots, curve(segment, frame))
      : { xyz: knots.flatMap((knot) => [knot.x, knot.y, knot.z]), times: knots.map((knot) => knot.t) };
    const fitted = fitCap(line.xyz, line.times);
    arcs.push({
      segmentIndex: segment.index,
      positions: new Float32Array(fitted.xyz),
      times: new Float32Array(fitted.times),
    });
  }
  return arcs;
}

function usableKnots(segment: OemSegment, frame: SupportedFrame): Knot[] {
  const start = segment.evalStart as number;
  const stop = segment.evalStop as number;
  const knots: Knot[] = [];
  for (const sample of segment.samples) {
    if (sample.t == null || sample.t < start - 1e-6 || sample.t > stop + 1e-6) continue;
    knots.push(knotAt(sample.t, frame, sample.positionM));
  }
  return knots;
}

function curve(segment: OemSegment, frame: SupportedFrame): Curve {
  return {
    plan: segment.plan,
    frame,
    times: segment.samples.map((sample) => sample.t as number),
    pos: [0, 1, 2].map((axis) => segment.samples.map((sample) => sample.positionM[axis])) as Curve["pos"],
    vel: [0, 1, 2].map((axis) => segment.samples.map((sample) => sample.velocityMps[axis])) as Curve["vel"],
  };
}

function knotAt(t: number, frame: SupportedFrame, position: Vec3): Knot {
  const eme = sourceToEme2000(frame, position);
  const scene = toScene(eme[0], eme[1], eme[2]);
  return { t, x: scene[0], y: scene[1], z: scene[2] };
}

/** Binary split while the interpolant leaves the straight chord. Linear segments are already straight. */
function refine(knots: Knot[], curve: Curve): { xyz: number[]; times: number[] } {
  const xyz: number[] = [knots[0].x, knots[0].y, knots[0].z];
  const times: number[] = [knots[0].t];
  for (let i = 1; i < knots.length; i += 1) emit(knots[i - 1], knots[i], curve, xyz, times, 0);
  return { xyz, times };
}

function emit(a: Knot, b: Knot, curve: Curve, xyz: number[], times: number[], depth: number) {
  const room = xyz.length / 3 < ARC_CAP - 1;
  const mid = room && depth < MAX_DEPTH && b.t - a.t > 1e-6 ? splitPoint(a, b, curve) : null;
  if (mid) {
    emit(a, mid, curve, xyz, times, depth + 1);
    emit(mid, b, curve, xyz, times, depth + 1);
    return;
  }
  xyz.push(b.x, b.y, b.z);
  times.push(b.t);
}

function splitPoint(a: Knot, b: Knot, curve: Curve): Knot | null {
  const mid = place(curve, (a.t + b.t) / 2);
  if (!mid) return null;
  if (segmentDistance(a, b, mid) > CHORD_KM) return mid;
  const quarter = place(curve, a.t + (b.t - a.t) * 0.25);
  if (quarter && segmentDistance(a, b, quarter) > CHORD_KM) return mid;
  return null;
}

function place(curve: Curve, t: number): Knot | null {
  const bracket = bracketIndex(curve.times, t);
  if (bracket == null || bracket >= curve.times.length - 1) return null;
  const position: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    position[axis] = interpolateComponent(curve.plan, curve.times, curve.pos[axis], curve.vel[axis], bracket, t).p;
  }
  return knotAt(t, curve.frame, position);
}

function segmentDistance(a: Knot, b: Knot, p: Knot): number {
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

/** Keep both ends when a refined line is past the vertex cap. */
function fitCap(xyz: number[], times: number[]): { xyz: number[]; times: number[] } {
  const count = times.length;
  if (count <= ARC_CAP) return { xyz, times };
  const stride = Math.ceil(count / ARC_CAP);
  const flat: number[] = [];
  const kept: number[] = [];
  for (let i = 0; i < count; i += stride) {
    flat.push(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
    kept.push(times[i]);
  }
  const last = count - 1;
  if (last % stride !== 0) {
    flat.push(xyz[last * 3], xyz[last * 3 + 1], xyz[last * 3 + 2]);
    kept.push(times[last]);
  }
  return { xyz: flat, times: kept };
}
