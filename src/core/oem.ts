/**
 * CCSDS 502.0-B-3 OEM, versions 2.0 and 3.0, KVN and 505.0-B-3 XML.
 * One OEM object per load. Covariance is retained and marked unused.
 * Comments stay plain text.
 */

import type { Vec3 } from "./types";
import type { InterpPlan } from "./interpolate";
import { planInterpolation } from "./interpolate";
import {
  ccsdsEpochShape,
  parseUtcEpoch,
  taiSecondsBetween,
  TimeScaleError,
  type TaiOrigin,
} from "./time";
import { orbitCenter } from "./centers";
import { supportedFrame } from "./frames";

export const MAX_OEM_CHARS = 50 * 1024 * 1024;

export class OemParseError extends Error {
  readonly context?: string;
  constructor(message: string, context?: string) {
    super(context ? `${message} (${context})` : message);
    this.name = "OemParseError";
    this.context = context;
  }
}

export type StateSample = {
  epochText: string;
  tai1: number | null;
  tai2: number | null;
  /** TAI seconds from the file origin. Null when the time scale is not UTC. */
  t: number | null;
  positionM: Vec3;
  velocityMps: Vec3;
  accelerationMps2?: Vec3;
  line: number;
};

export type CovarianceBlock = {
  unused: true;
  text: string;
  context: string;
};

export type OemSegment = {
  index: number;
  objectName: string;
  objectId: string;
  centerName: string;
  refFrame: string;
  refFrameEpoch: string | null;
  timeSystem: string;
  startTime: string | null;
  stopTime: string | null;
  usableStart: string | null;
  usableStop: string | null;
  interpolationMethod: string | null;
  interpolationDegree: number | null;
  plan: InterpPlan;
  samples: StateSample[];
  evalStart: number | null;
  evalStop: number | null;
  calculationSupported: boolean;
  unsupportedReason: string | null;
  comments: string[];
};

export type OemFile = {
  version: string;
  creationDate: string | null;
  originator: string | null;
  messageId: string | null;
  comments: string[];
  segments: OemSegment[];
  covariances: CovarianceBlock[];
  warnings: string[];
  origin: TaiOrigin | null;
  format: "kvn" | "xml" | "spk";
};

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function num(token: string, context: string): number {
  if (!NUM.test(token)) throw new OemParseError(`Malformed number "${token}"`, context);
  const value = Number(token);
  if (!Number.isFinite(value)) throw new OemParseError(`Non-finite number "${token}"`, context);
  return value;
}

function km(token: string, context: string): number {
  return num(token, context) * 1000;
}

export function parseOem(text: string): OemFile {
  if (text.length > MAX_OEM_CHARS) {
    throw new OemParseError(`File is larger than ${MAX_OEM_CHARS / (1024 * 1024)} MB`);
  }
  const stripped = text.replace(/^\uFEFF/, "");
  const head = stripped.trimStart();
  if (!head) throw new OemParseError("File is empty");
  const oem = head.startsWith("<") ? parseXmlOem(stripped) : parseKvn(stripped);
  finalizeTimes(oem);
  return oem;
}

type Meta = Record<string, string>;

function parseKvn(text: string): OemFile {
  const lines = text.split(/\r\n|\n|\r/);
  const warnings: string[] = [];
  const comments: string[] = [];
  const covariances: CovarianceBlock[] = [];
  let version: string | null = null;
  let creation: string | null = null;
  let originator: string | null = null;
  let messageId: string | null = null;
  const headerSeen = new Set<string>();
  let mode: "header" | "meta" | "data" | "cov" = "header";
  let meta: Meta | null = null;
  let metaSeen = new Set<string>();
  let metaComments: string[] = [];
  let samples: StateSample[] = [];
  let accel: boolean | null = null;
  const segments: OemSegment[] = [];
  let covLines: string[] = [];

  const pushSegment = (at: string) => {
    if (!meta) throw new OemParseError("State data is missing its metadata block", at);
    segments.push(buildSegment(segments.length, meta, metaComments, samples, accel === true, warnings, at));
    meta = null;
    metaComments = [];
    samples = [];
    accel = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const where = `line ${lineNo}`;
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (/^COMMENT\b/i.test(line)) {
      const textValue = line.replace(/^COMMENT\s*=?\s?/i, "");
      if (mode === "header") comments.push(textValue);
      else if (mode === "meta" || mode === "data") metaComments.push(textValue);
      else covLines.push(raw.trimEnd());
      continue;
    }
    if (line === "META_START") {
      if (mode === "data") pushSegment(where);
      if (mode === "meta" || mode === "cov") {
        throw new OemParseError("META_START inside an open block", where);
      }
      mode = "meta";
      meta = {};
      metaSeen = new Set();
      metaComments = [];
      samples = [];
      accel = null;
      continue;
    }
    if (line === "META_STOP") {
      if (mode !== "meta") throw new OemParseError("META_STOP without META_START", where);
      mode = "data";
      continue;
    }
    if (line === "COVARIANCE_START") {
      if (mode === "data" && meta) pushSegment(where);
      if (mode === "meta" || mode === "cov") {
        throw new OemParseError("COVARIANCE_START inside an open block", where);
      }
      mode = "cov";
      covLines = [];
      continue;
    }
    if (line === "COVARIANCE_STOP") {
      if (mode !== "cov") throw new OemParseError("COVARIANCE_STOP without COVARIANCE_START", where);
      covariances.push({
        unused: true,
        text: covLines.join("\n"),
        context: where,
      });
      mode = "header";
      continue;
    }

    const kw = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (kw && mode !== "data") {
      const key = kw[1].toUpperCase();
      const value = kw[2].trim();
      if (mode === "header") {
        if (headerSeen.has(key)) throw new OemParseError(`Duplicate header field ${key}`, where);
        headerSeen.add(key);
        if (key === "CCSDS_OEM_VERS") version = value;
        else if (key === "CREATION_DATE") creation = value;
        else if (key === "ORIGINATOR") originator = value;
        else if (key === "MESSAGE_ID") messageId = value;
        else warnings.push(`Unrecognized header field ${key} (${where})`);
      } else if (mode === "meta" && meta) {
        if (metaSeen.has(key)) throw new OemParseError(`Duplicate metadata field ${key}`, where);
        metaSeen.add(key);
        meta[key] = value;
      } else if (mode === "cov") {
        covLines.push(raw.trimEnd());
      }
      continue;
    }
    if (mode === "cov") {
      covLines.push(raw.trimEnd());
      continue;
    }
    if (mode !== "data") {
      throw new OemParseError(`Unexpected content "${line.slice(0, 80)}"`, where);
    }
    const parts = line.split(/\s+/);
    if (parts.length !== 7 && parts.length !== 10) {
      throw new OemParseError(`State row must have 7 or 10 fields, found ${parts.length}`, where);
    }
    if (!ccsdsEpochShape(parts[0])) {
      throw new OemParseError(`Malformed epoch "${parts[0]}"`, where);
    }
    const rowAccel = parts.length === 10;
    if (accel == null) accel = rowAccel;
    else if (accel !== rowAccel) {
      throw new OemParseError("Acceleration is present on some state rows and missing on others", where);
    }
    const sample: StateSample = {
      epochText: parts[0],
      tai1: null,
      tai2: null,
      t: null,
      positionM: [km(parts[1], where), km(parts[2], where), km(parts[3], where)],
      velocityMps: [km(parts[4], where), km(parts[5], where), km(parts[6], where)],
      line: lineNo,
    };
    if (rowAccel) {
      sample.accelerationMps2 = [km(parts[7], where), km(parts[8], where), km(parts[9], where)];
    }
    samples.push(sample);
  }
  if (mode === "meta" || mode === "cov") {
    throw new OemParseError(`File ended inside a ${mode === "meta" ? "metadata" : "covariance"} block`);
  }
  if (mode === "data" && meta) pushSegment("end of file");
  if (!version) throw new OemParseError("CCSDS_OEM_VERS is missing");
  if (version !== "2.0" && version !== "3.0") {
    throw new OemParseError(`OEM version ${version} is outside the supported 2.0 and 3.0 profile`);
  }
  if (!creation) throw new OemParseError("CREATION_DATE is missing");
  if (!originator) throw new OemParseError("ORIGINATOR is missing");
  if (segments.length === 0) throw new OemParseError("OEM contains no segments");
  return {
    version,
    creationDate: creation,
    originator,
    messageId,
    comments,
    segments,
    covariances,
    warnings,
    origin: null,
    format: "kvn",
  };
}

const REQUIRED_META = [
  "OBJECT_NAME",
  "OBJECT_ID",
  "CENTER_NAME",
  "REF_FRAME",
  "TIME_SYSTEM",
  "START_TIME",
  "STOP_TIME",
] as const;

function buildSegment(
  index: number,
  meta: Meta,
  comments: string[],
  samples: StateSample[],
  hasAccel: boolean,
  warnings: string[],
  context: string,
): OemSegment {
  for (const key of REQUIRED_META) {
    if (!meta[key]) throw new OemParseError(`Missing metadata ${key}`, context);
  }
  if (samples.length === 0) throw new OemParseError("Segment has no state vectors", context);
  let degree: number | null = null;
  if (meta.INTERPOLATION_DEGREE != null) {
    if (!/^[+-]?\d+$/.test(meta.INTERPOLATION_DEGREE)) {
      throw new OemParseError(`INTERPOLATION_DEGREE "${meta.INTERPOLATION_DEGREE}" is not an integer`, context);
    }
    degree = Number(meta.INTERPOLATION_DEGREE);
  }
  const known = new Set([
    ...REQUIRED_META,
    "USEABLE_START_TIME",
    "USEABLE_STOP_TIME",
    "INTERPOLATION",
    "INTERPOLATION_DEGREE",
    "REF_FRAME_EPOCH",
  ]);
  for (const key of Object.keys(meta)) {
    if (!known.has(key)) warnings.push(`Unrecognized metadata ${key} on segment ${index + 1}`);
  }
  const timeSystem = meta.TIME_SYSTEM;
  const utc = timeSystem.toUpperCase() === "UTC";
  if (utc) {
    let previous: { tai1: number; tai2: number } | null = null;
    for (const sample of samples) {
      let parsed;
      try {
        parsed = parseUtcEpoch(sample.epochText);
      } catch (error) {
        const message = error instanceof TimeScaleError ? error.message : "Invalid epoch";
        throw new OemParseError(message, `line ${sample.line}`);
      }
      sample.tai1 = parsed.tai1;
      sample.tai2 = parsed.tai2;
      if (parsed.dubious) {
        warnings.push(`Epoch ${sample.epochText} is after the leap-second table expiry (line ${sample.line})`);
      }
      if (
        previous &&
        taiSecondsBetween(parsed.tai1, parsed.tai2, previous.tai1, previous.tai2) <= 1e-9
      ) {
        throw new OemParseError("Epochs in a segment must be strictly increasing", `line ${sample.line}`);
      }
      previous = { tai1: parsed.tai1, tai2: parsed.tai2 };
    }
  } else {
    for (const sample of samples) {
      if (!ccsdsEpochShape(sample.epochText)) {
        throw new OemParseError(`Malformed epoch "${sample.epochText}"`, `line ${sample.line}`);
      }
    }
    warnings.push(
      `Segment ${index + 1} time system ${timeSystem} is not UTC. The segment can be inspected, and trajectory calculations stay off.`,
    );
  }

  const plan = planInterpolation(meta.INTERPOLATION ?? null, degree, samples.length);
  if (!plan.supported && plan.reason) warnings.push(`Segment ${index + 1}: ${plan.reason}`);

  let outside = 0;
  if (utc && samples[0].tai1 != null && samples[0].tai2 != null) {
    const start = parseBound(meta.START_TIME, "START_TIME", context);
    const stop = parseBound(meta.STOP_TIME, "STOP_TIME", context);
    const stopSec = taiSecondsBetween(stop.tai1, stop.tai2, start.tai1, start.tai2);
    if (stopSec < -1e-6) throw new OemParseError("STOP_TIME is before START_TIME", context);
    let win0 = start;
    let win1 = stop;
    const u0 = meta.USEABLE_START_TIME;
    const u1 = meta.USEABLE_STOP_TIME;
    if ((u0 == null) !== (u1 == null)) {
      throw new OemParseError("USEABLE_START_TIME and USEABLE_STOP_TIME must be supplied together", context);
    }
    if (u0 && u1) {
      win0 = parseBound(u0, "USEABLE_START_TIME", context);
      win1 = parseBound(u1, "USEABLE_STOP_TIME", context);
      const usableSpan = taiSecondsBetween(win1.tai1, win1.tai2, win0.tai1, win0.tai2);
      if (usableSpan < -1e-6) throw new OemParseError("USEABLE_STOP_TIME is before USEABLE_START_TIME", context);
      const lead = taiSecondsBetween(win0.tai1, win0.tai2, start.tai1, start.tai2);
      const tail = taiSecondsBetween(stop.tai1, stop.tai2, win1.tai1, win1.tai2);
      if (lead < -1e-4 || tail < -1e-4) {
        throw new OemParseError("Usable window is outside START_TIME/STOP_TIME", context);
      }
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    for (const sample of samples) {
      if (sample.tai1 == null || sample.tai2 == null) continue;
      const fromStart = taiSecondsBetween(sample.tai1, sample.tai2, start.tai1, start.tai2);
      if (fromStart < -1e-3 || fromStart > stopSec + 1e-3) outside += 1;
    }
    if (outside > 0) {
      warnings.push(
        `Segment ${index + 1} has ${outside} samples outside START_TIME/STOP_TIME. They are kept as interpolation support.`,
      );
    }
    const cover0 = taiSecondsBetween(first.tai1!, first.tai2!, win0.tai1, win0.tai2);
    const cover1 = taiSecondsBetween(last.tai1!, last.tai2!, win0.tai1, win0.tai2);
    const winSpan = taiSecondsBetween(win1.tai1, win1.tai2, win0.tai1, win0.tai2);
    if (Math.min(winSpan, cover1) < Math.max(0, cover0) - 1e-6) {
      throw new OemParseError("Usable window does not overlap the sampled epochs", context);
    }
  }

  const frame = supportedFrame(meta.REF_FRAME);
  const center = orbitCenter(meta.CENTER_NAME);
  const reasons: string[] = [];
  if (!utc) reasons.push(`time system ${timeSystem} is not UTC`);
  if (!center) reasons.push(`center ${meta.CENTER_NAME} is outside the SANA orbit-center profile`);
  if (!frame) reasons.push(`frame ${meta.REF_FRAME} is not in the EME2000/GCRF/ICRF profile`);
  if (!plan.supported) reasons.push(plan.reason ?? "interpolation is not supported");
  void hasAccel;

  return {
    index,
    objectName: meta.OBJECT_NAME,
    objectId: meta.OBJECT_ID,
    centerName: meta.CENTER_NAME,
    refFrame: meta.REF_FRAME,
    refFrameEpoch: meta.REF_FRAME_EPOCH ?? null,
    timeSystem,
    startTime: meta.START_TIME,
    stopTime: meta.STOP_TIME,
    usableStart: meta.USEABLE_START_TIME ?? null,
    usableStop: meta.USEABLE_STOP_TIME ?? null,
    interpolationMethod: meta.INTERPOLATION ?? null,
    interpolationDegree: degree,
    plan,
    samples,
    evalStart: null,
    evalStop: null,
    calculationSupported: reasons.length === 0,
    unsupportedReason: reasons.length ? reasons.join("; ") : null,
    comments,
  };
}

function parseBound(value: string, name: string, context: string): { tai1: number; tai2: number } {
  try {
    const parsed = parseUtcEpoch(value);
    return { tai1: parsed.tai1, tai2: parsed.tai2 };
  } catch (error) {
    const message = error instanceof TimeScaleError ? error.message : "Invalid epoch";
    throw new OemParseError(`${name}: ${message}`, context);
  }
}

function finalizeTimes(oem: OemFile): void {
  let origin: TaiOrigin | null = null;
  for (const segment of oem.segments) {
    for (const sample of segment.samples) {
      if (sample.tai1 != null && sample.tai2 != null) {
        origin = { tai1: sample.tai1, tai2: sample.tai2 };
        break;
      }
    }
    if (origin) break;
  }
  oem.origin = origin;
  if (!origin) return;
  for (const segment of oem.segments) {
    if (segment.timeSystem.toUpperCase() !== "UTC") continue;
    for (const sample of segment.samples) {
      if (sample.tai1 == null || sample.tai2 == null) continue;
      sample.t = taiSecondsBetween(sample.tai1, sample.tai2, origin.tai1, origin.tai2);
    }
    const times = segment.samples.map((sample) => sample.t).filter((t): t is number => t != null);
    const start = segment.startTime ? relOf(segment.startTime, origin, `segment ${segment.index + 1} START_TIME`) : times[0];
    const stop = segment.stopTime ? relOf(segment.stopTime, origin, `segment ${segment.index + 1} STOP_TIME`) : times[times.length - 1];
    let win0 = start;
    let win1 = stop;
    if (segment.usableStart && segment.usableStop) {
      win0 = relOf(segment.usableStart, origin, `segment ${segment.index + 1} USEABLE_START_TIME`);
      win1 = relOf(segment.usableStop, origin, `segment ${segment.index + 1} USEABLE_STOP_TIME`);
    }
    const eval0 = Math.max(win0, times[0]);
    const eval1 = Math.min(win1, times[times.length - 1]);
    segment.evalStart = eval0;
    segment.evalStop = eval1;
    const dts: number[] = [];
    for (let i = 1; i < times.length; i += 1) dts.push(times[i] - times[i - 1]);
    if (dts.length) {
      const sorted = [...dts].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      if (mid > 1800) {
        oem.warnings.push(
          `Segment ${segment.index + 1} samples are sparse (median spacing ${Math.round(mid / 60)} min). The arc follows the file samples. Gaps are not inferred from the spacing.`,
        );
      }
    }
  }
}

function relOf(epoch: string, origin: TaiOrigin, context: string): number {
  try {
    const parsed = parseUtcEpoch(epoch);
    return taiSecondsBetween(parsed.tai1, parsed.tai2, origin.tai1, origin.tai2);
  } catch (error) {
    const message = error instanceof TimeScaleError ? error.message : "Invalid epoch";
    throw new OemParseError(`${context}: ${message}`);
  }
}

type XmlNode = {
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
  line: number;
};

function parseXmlOem(text: string): OemFile {
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new OemParseError("XML with a DOCTYPE or entity declaration is not accepted");
  }
  const root = parseXml(text);
  const oems: XmlNode[] = [];
  collect(root, "oem", oems);
  if (oems.length === 0) throw new OemParseError("XML does not contain an oem element");
  if (oems.length > 1) throw new OemParseError("Only one OEM object can be loaded");
  const oem = oems[0];
  const header = child(oem, "header");
  if (!header) throw new OemParseError("OEM XML is missing header", pathOf(oem, "header"));
  const version =
    attr(oem, "version") ??
    textOf(header, "CCSDS_OEM_VERS") ??
    textOf(header, "ccsds_oem_vers");
  if (!version) throw new OemParseError("OEM XML version is missing", "oem");
  if (version !== "2.0" && version !== "3.0") {
    throw new OemParseError(`OEM version ${version} is outside the supported 2.0 and 3.0 profile`, "oem");
  }
  const warnings: string[] = [];
  let unitsAssumed = false;
  const comments = children(header, "COMMENT").map((node) => node.text.trim());
  const body = child(oem, "body");
  const segmentNodes = body ? children(body, "segment") : children(oem, "segment");
  if (segmentNodes.length === 0) throw new OemParseError("OEM XML contains no segments", "oem/body");
  const segments: OemSegment[] = [];
  const covariances: CovarianceBlock[] = [];
  segmentNodes.forEach((segmentNode, index) => {
    const context = `oem/body/segment[${index + 1}]`;
    const metadata = child(segmentNode, "metadata");
    if (!metadata) throw new OemParseError("Segment is missing metadata", context);
    const meta: Meta = {};
    const seen = new Set<string>();
    const metaComments: string[] = [];
    for (const node of metadata.children) {
      const key = node.local.toUpperCase();
      if (key === "COMMENT") {
        metaComments.push(node.text.trim());
        continue;
      }
      if (seen.has(key)) throw new OemParseError(`Duplicate metadata field ${key}`, `${context}/metadata/${node.local}`);
      seen.add(key);
      meta[key] = node.text.trim();
    }
    const data = child(segmentNode, "data");
    if (!data) throw new OemParseError("Segment is missing data", context);
    for (const node of data.children) {
      if (node.local.toUpperCase() === "COMMENT") metaComments.push(node.text.trim());
    }
    const vectors = children(data, "stateVector");
    let accel: boolean | null = null;
    const samples: StateSample[] = vectors.map((vector, sampleIndex) => {
      const sampleContext = `${context}/data/stateVector[${sampleIndex + 1}]`;
      const epoch = requiredText(vector, "EPOCH", sampleContext);
      const x = component(vector, "X", "position", sampleContext, () => {
        unitsAssumed = true;
      });
      const y = component(vector, "Y", "position", sampleContext, () => {
        unitsAssumed = true;
      });
      const z = component(vector, "Z", "position", sampleContext, () => {
        unitsAssumed = true;
      });
      const vx = component(vector, "X_DOT", "velocity", sampleContext, () => {
        unitsAssumed = true;
      });
      const vy = component(vector, "Y_DOT", "velocity", sampleContext, () => {
        unitsAssumed = true;
      });
      const vz = component(vector, "Z_DOT", "velocity", sampleContext, () => {
        unitsAssumed = true;
      });
      const ax = optionalComponent(vector, "X_DDOT", "acceleration", sampleContext);
      const ay = optionalComponent(vector, "Y_DDOT", "acceleration", sampleContext);
      const az = optionalComponent(vector, "Z_DDOT", "acceleration", sampleContext);
      const present = ax != null || ay != null || az != null;
      if (present && (ax == null || ay == null || az == null)) {
        throw new OemParseError("Acceleration components must all be present", sampleContext);
      }
      if (accel == null) accel = present;
      else if (accel !== present) {
        throw new OemParseError("Acceleration is present on some state vectors and missing on others", sampleContext);
      }
      const sample: StateSample = {
        epochText: epoch,
        tai1: null,
        tai2: null,
        t: null,
        positionM: [x * 1000, y * 1000, z * 1000],
        velocityMps: [vx * 1000, vy * 1000, vz * 1000],
        line: vector.line,
      };
      if (present && ax != null && ay != null && az != null) {
        sample.accelerationMps2 = [ax * 1000, ay * 1000, az * 1000];
      }
      return sample;
    });
    segments.push(buildSegment(index, meta, metaComments, samples, accel === true, warnings, context));
    for (const node of segmentNode.children) {
      if (node.local.toLowerCase().includes("covariance")) {
        covariances.push({ unused: true, text: xmlText(node).trim(), context: `${context}/${node.local}` });
      }
    }
  });
  if (unitsAssumed) {
    warnings.push("XML state units were omitted. km, km/s, and km/s² were assumed.");
  }
  const creation = textOf(header, "CREATION_DATE");
  const originator = textOf(header, "ORIGINATOR");
  if (!creation) throw new OemParseError("CREATION_DATE is missing", "oem/header");
  if (!originator) throw new OemParseError("ORIGINATOR is missing", "oem/header");
  return {
    version,
    creationDate: creation,
    originator,
    messageId: textOf(header, "MESSAGE_ID"),
    comments,
    segments,
    covariances,
    warnings,
    origin: null,
    format: "xml",
  };
}

function component(
  vector: XmlNode,
  name: string,
  kind: "position" | "velocity" | "acceleration",
  context: string,
  assumed: () => void,
): number {
  const node = child(vector, name);
  if (!node) throw new OemParseError(`Missing ${name}`, context);
  const units = attr(node, "units");
  if (!units) assumed();
  else if (!unitOk(units, kind)) {
    throw new OemParseError(`${name} units "${units}" are not ${expectedUnit(kind)}`, context);
  }
  return num(node.text.trim(), `${context}/${name}`);
}

function optionalComponent(
  vector: XmlNode,
  name: string,
  kind: "acceleration",
  context: string,
): number | null {
  const node = child(vector, name);
  if (!node || !node.text.trim()) return null;
  const units = attr(node, "units");
  if (units && !unitOk(units, kind)) {
    throw new OemParseError(`${name} units "${units}" are not km/s²`, context);
  }
  return num(node.text.trim(), `${context}/${name}`);
}

function expectedUnit(kind: "position" | "velocity" | "acceleration"): string {
  if (kind === "position") return "km";
  if (kind === "velocity") return "km/s";
  return "km/s²";
}

function unitOk(units: string, kind: "position" | "velocity" | "acceleration"): boolean {
  const value = units.trim().toLowerCase().replace(/\s+/g, "");
  if (kind === "position") return value === "km";
  if (kind === "velocity") return value === "km/s";
  return value === "km/s**2" || value === "km/s^2" || value === "km/s2";
}

function requiredText(node: XmlNode, name: string, context: string): string {
  const found = child(node, name);
  if (!found || !found.text.trim()) throw new OemParseError(`Missing ${name}`, context);
  if (!ccsdsEpochShape(found.text.trim())) {
    throw new OemParseError(`Malformed epoch "${found.text.trim()}"`, `${context}/${name}`);
  }
  return found.text.trim();
}

function child(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((item) => item.local === name) ?? null;
}

function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((item) => item.local === name);
}

function textOf(node: XmlNode, name: string): string | null {
  const found = child(node, name);
  const text = found?.text.trim();
  return text ? text : null;
}

function attr(node: XmlNode, name: string): string | undefined {
  for (const [key, value] of Object.entries(node.attrs)) {
    const local = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
    if (local === name) return value;
  }
  return undefined;
}

function collect(node: XmlNode, name: string, out: XmlNode[]): void {
  if (node.local === name) out.push(node);
  for (const childNode of node.children) collect(childNode, name, out);
}

function pathOf(node: XmlNode, extra: string): string {
  return `${node.local}/${extra}`;
}

function xmlText(node: XmlNode): string {
  return node.text + node.children.map(xmlText).join("");
}

function parseXml(text: string): XmlNode {
  const root: XmlNode = { local: "#root", attrs: {}, children: [], text: "", line: 1 };
  const stack = [root];
  let i = 0;
  let line = 1;
  const bump = (chunk: string) => {
    for (const ch of chunk) if (ch === "\n") line += 1;
  };
  while (i < text.length) {
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i);
      if (end < 0) throw new OemParseError("Unclosed XML declaration", `line ${line}`);
      bump(text.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i);
      if (end < 0) throw new OemParseError("Unclosed XML comment", `line ${line}`);
      bump(text.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i);
      if (end < 0) throw new OemParseError("Unclosed CDATA", `line ${line}`);
      stack[stack.length - 1].text += text.slice(i + 9, end);
      bump(text.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    if (text[i] === "<") {
      const end = text.indexOf(">", i);
      if (end < 0) throw new OemParseError("Unclosed tag", `line ${line}`);
      const raw = text.slice(i + 1, end).trim();
      const startLine = line;
      bump(text.slice(i, end + 1));
      i = end + 1;
      if (raw.startsWith("/")) {
        const name = localName(raw.slice(1).trim());
        const top = stack.pop();
        if (!top || top.local !== name) throw new OemParseError(`Mismatched end tag ${name}`, `line ${startLine}`);
        continue;
      }
      const self = raw.endsWith("/");
      const body = self ? raw.slice(0, -1).trim() : raw;
      const parsed = startTag(body, startLine);
      const node: XmlNode = { local: localName(parsed.name), attrs: parsed.attrs, children: [], text: "", line: startLine };
      stack[stack.length - 1].children.push(node);
      if (!self) stack.push(node);
      continue;
    }
    const next = text.indexOf("<", i);
    const chunk = text.slice(i, next < 0 ? text.length : next);
    stack[stack.length - 1].text += decodeXml(chunk, line);
    bump(chunk);
    i = next < 0 ? text.length : next;
  }
  if (stack.length !== 1) throw new OemParseError("Unclosed XML element", `line ${line}`);
  return root;
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function startTag(body: string, line: number): { name: string; attrs: Record<string, string> } {
  const match = /^([^\s/>]+)([\s\S]*)$/.exec(body);
  if (!match) throw new OemParseError("Empty tag", `line ${line}`);
  const name = match[1];
  let rest = match[2].trim();
  const attrs: Record<string, string> = {};
  const attrRe = /^([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')(?:\s+|$)/;
  while (rest.length > 0) {
    const found = attrRe.exec(rest);
    if (!found) throw new OemParseError(`Malformed attributes in <${name}>`, `line ${line}`);
    attrs[found[1]] = decodeXml(found[2] ?? found[3] ?? "", line);
    rest = rest.slice(found[0].length).trim();
  }
  return { name, attrs };
}

function decodeXml(raw: string, line: number): string {
  const decoded = raw.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_all, entity: string) => {
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "amp") return "&";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const code = entity[1] === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
      throw new OemParseError(`Invalid character reference &${entity};`, `line ${line}`);
    }
    return String.fromCodePoint(code);
  });
  if (decoded.includes("&")) throw new OemParseError("Unsupported or unescaped ampersand", `line ${line}`);
  return decoded;
}
