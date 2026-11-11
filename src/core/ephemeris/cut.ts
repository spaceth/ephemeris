/**
 * Copy native type 2 and 3 records whose intervals overlap a window.
 * Coefficients are not resampled. Each output segment keeps its own
 * degree, interval length, and first boundary from the source descriptor.
 */

import { readDouble, readSpkSummaries, type SpkSegmentSummary } from "./daf";
import { writeSpkParts, type SpkPart } from "./dafWrite";

export type CutSegment = {
  target: number;
  center: number;
  frame: number;
  type: number;
  startEt: number;
  stopEt: number;
  init: number;
  intervalLength: number;
  recordSize: number;
  count: number;
  degree: number;
};

export type CutResult = {
  buffer: ArrayBuffer;
  segments: CutSegment[];
};

function overlap(segment: SpkSegmentSummary, init: number, intervalLength: number, count: number, startEt: number, stopEt: number): { first: number; last: number } | null {
  const polyStart = init;
  const polyStop = init + count * intervalLength;
  const from = Math.max(startEt, segment.startEt);
  const to = Math.min(stopEt, segment.stopEt);
  if (!(to >= from) || to < polyStart || from > polyStop) return null;
  let first = Math.floor((Math.max(from, polyStart) - init) / intervalLength);
  let last = Math.floor((Math.min(to, polyStop) - init) / intervalLength);
  if (from >= polyStop) first = count - 1;
  if (last >= count) last = count - 1;
  if (first < 0) first = 0;
  if (first > last) return null;
  return { first, last };
}

/**
 * Keep every source segment whose target is listed and whose coverage overlaps
 * `[startEt, stopEt]`. File order is preserved, so later segments stay higher priority.
 */
export function cutSpk(buffer: ArrayBuffer, targets: readonly number[], startEt: number, stopEt: number): CutResult {
  const contents = readSpkSummaries(buffer);
  if (!contents.littleEndian) throw new Error("The cutter writes little-endian SPK and was given a big-endian kernel");
  const wanted = new Set(targets);
  const parts: SpkPart[] = [];
  const segments: CutSegment[] = [];
  for (const segment of contents.segments) {
    if (!wanted.has(segment.target)) continue;
    if (segment.type !== 2 && segment.type !== 3) {
      throw new Error(`Target ${segment.target} is SPK type ${segment.type}. The cutter keeps native type 2 and 3 records only.`);
    }
    const init = readDouble(buffer, true, segment.finalAddress - 3);
    const intervalLength = readDouble(buffer, true, segment.finalAddress - 2);
    const recordSize = readDouble(buffer, true, segment.finalAddress - 1);
    const count = readDouble(buffer, true, segment.finalAddress);
    if (!Number.isInteger(recordSize) || !Number.isInteger(count) || intervalLength <= 0) {
      throw new Error(`Target ${segment.target} has a directory this cutter cannot index`);
    }
    const range = overlap(segment, init, intervalLength, count, startEt, stopEt);
    if (!range) continue;
    const kept = range.last - range.first + 1;
    const nextInit = init + range.first * intervalLength;
    const recordBytes = recordSize * 8;
    const element = new Uint8Array((kept * recordSize + 4) * 8);
    const source = new Uint8Array(buffer, (segment.initialAddress - 1 + range.first * recordSize) * 8, kept * recordBytes);
    element.set(source, 0);
    const view = new DataView(element.buffer);
    const directory = kept * recordSize;
    view.setFloat64(directory * 8, nextInit, true);
    view.setFloat64((directory + 1) * 8, intervalLength, true);
    view.setFloat64((directory + 2) * 8, recordSize, true);
    view.setFloat64((directory + 3) * 8, kept, true);
    const keptStart = nextInit;
    const keptStop = nextInit + kept * intervalLength;
    const outStart = Math.max(segment.startEt, keptStart);
    const outStop = Math.min(segment.stopEt, keptStop);
    const components = segment.type === 2 ? 3 : 6;
    parts.push({
      target: segment.target,
      center: segment.center,
      frame: segment.frame,
      type: segment.type,
      startEt: outStart,
      stopEt: outStop,
      element,
    });
    segments.push({
      target: segment.target,
      center: segment.center,
      frame: segment.frame,
      type: segment.type,
      startEt: outStart,
      stopEt: outStop,
      init: nextInit,
      intervalLength,
      recordSize,
      count: kept,
      degree: (recordSize - 2) / components - 1,
    });
  }
  return { buffer: writeSpkParts(parts), segments };
}
