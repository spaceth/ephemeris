import { sourceToEme2000, supportedFrame } from "./core/frames";
import type { OemFile } from "./core/oem";
import { toScene } from "./core/scene";

export type ArcBuffer = {
  segmentIndex: number;
  positions: Float32Array;
};

export type WorkerRequest = { type: "parse"; id: number; text: string; name: string };

export type WorkerResponse =
  | { type: "parsed"; id: number; name: string; file: OemFile; arcs: ArcBuffer[] }
  | { type: "parse-error"; id: number; message: string };

const ARC_CAP = 20000;

/** One scene polyline per segment, in EME2000 kilometers. Support samples outside the usable window are left out. */
export function buildArcs(file: OemFile): ArcBuffer[] {
  const arcs: ArcBuffer[] = [];
  for (const segment of file.segments) {
    const frame = supportedFrame(segment.refFrame);
    if (!frame || segment.centerName.toUpperCase() !== "EARTH") continue;
    if (segment.evalStart == null || segment.evalStop == null) continue;
    const xyz: number[] = [];
    for (const sample of segment.samples) {
      if (sample.t == null) continue;
      if (sample.t < segment.evalStart - 1e-6 || sample.t > segment.evalStop + 1e-6) continue;
      const eme = sourceToEme2000(frame, sample.positionM);
      const scene = toScene(eme[0], eme[1], eme[2]);
      xyz.push(scene[0], scene[1], scene[2]);
    }
    const count = xyz.length / 3;
    if (count < 2) continue;
    let flat = xyz;
    if (count > ARC_CAP) {
      const stride = Math.ceil(count / ARC_CAP);
      flat = [];
      for (let i = 0; i < count; i += stride) {
        flat.push(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
      }
      const last = (count - 1) * 3;
      if (flat[flat.length - 3] !== xyz[last]) flat.push(xyz[last], xyz[last + 1], xyz[last + 2]);
    }
    arcs.push({ segmentIndex: segment.index, positions: new Float32Array(flat) });
  }
  return arcs;
}
