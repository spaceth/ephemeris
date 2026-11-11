/**
 * DAF/SPK summary reader.
 * Segment centers and frames come from the summary integers, not from names.
 * A segment's element records stay in the file buffer until evaluation.
 */

export type SpkSegmentSummary = {
  target: number;
  center: number;
  frame: number;
  type: number;
  /** TDB seconds past J2000. Closed interval. */
  startEt: number;
  stopEt: number;
  /** 1-based double-word address of the first element word. */
  initialAddress: number;
  /** 1-based double-word address of the last element word. */
  finalAddress: number;
  /** Index in file order. Later indexes have higher priority. */
  index: number;
};

export type SpkContents = {
  littleEndian: boolean;
  segments: SpkSegmentSummary[];
};

const RECORD_BYTES = 1024;
const DOUBLES_PER_RECORD = 128;

export class SpkReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpkReadError";
  }
}

function locfmtEndian(text: string): boolean | null {
  if (text.startsWith("LTL-IEEE")) return true;
  if (text.startsWith("BIG-IEEE")) return false;
  return null;
}

/** Read an SPK file's segment summaries. Element arrays are not copied. */
export function readSpkSummaries(buffer: ArrayBuffer): SpkContents {
  if (buffer.byteLength < RECORD_BYTES) throw new SpkReadError("SPK file is shorter than one DAF record");
  const view = new DataView(buffer);
  const id = String.fromCharCode(...new Uint8Array(buffer, 0, 8));
  if (!id.startsWith("DAF/SPK")) throw new SpkReadError(`Not an SPK file (${id.trim() || "empty"})`);
  const endianMark = locfmtEndian(String.fromCharCode(...new Uint8Array(buffer, 88, 8)));
  if (endianMark == null) throw new SpkReadError("SPK file has no LTL-IEEE or BIG-IEEE format mark");
  const littleEndian = endianMark;
  const nd = view.getInt32(8, littleEndian);
  const ni = view.getInt32(12, littleEndian);
  if (nd !== 2 || ni !== 6) throw new SpkReadError(`SPK summary layout ND=${nd} NI=${ni} is not the planetary layout`);
  const fward = view.getInt32(76, littleEndian);
  const summaryDoubles = nd + Math.floor((ni + 1) / 2);
  const segments: SpkSegmentSummary[] = [];
  const seen = new Set<number>();
  let record = fward;
  while (record !== 0) {
    if (seen.has(record)) throw new SpkReadError("SPK summary records form a cycle");
    seen.add(record);
    if (record < 1) throw new SpkReadError(`SPK summary record ${record} is not a valid record number`);
    const base = (record - 1) * RECORD_BYTES;
    if (base + RECORD_BYTES > buffer.byteLength) throw new SpkReadError("SPK summary record runs past the end of the file");
    const next = view.getFloat64(base, littleEndian);
    const count = Math.round(view.getFloat64(base + 16, littleEndian));
    const room = Math.floor((DOUBLES_PER_RECORD - 3) / summaryDoubles);
    if (count < 0 || count > room) throw new SpkReadError(`SPK summary count ${count} does not fit in a record`);
    for (let i = 0; i < count; i += 1) {
      const at = base + (3 + i * summaryDoubles) * 8;
      const startEt = view.getFloat64(at, littleEndian);
      const stopEt = view.getFloat64(at + 8, littleEndian);
      const target = view.getInt32(at + 16, littleEndian);
      const center = view.getInt32(at + 20, littleEndian);
      const frame = view.getInt32(at + 24, littleEndian);
      const type = view.getInt32(at + 28, littleEndian);
      const initialAddress = view.getInt32(at + 32, littleEndian);
      const finalAddress = view.getInt32(at + 36, littleEndian);
      segments.push({
        target,
        center,
        frame,
        type,
        startEt,
        stopEt,
        initialAddress,
        finalAddress,
        index: segments.length,
      });
    }
    record = Math.round(next);
  }
  return { littleEndian, segments };
}

export function readDouble(buffer: ArrayBuffer, littleEndian: boolean, address: number): number {
  const offset = (address - 1) * 8;
  if (address < 1 || offset + 8 > buffer.byteLength) {
    throw new SpkReadError(`SPK address ${address} is outside the file`);
  }
  return new DataView(buffer).getFloat64(offset, littleEndian);
}

/** Words of one type-2 or type-3 record, including midpoint and radius. */
export function readWords(buffer: ArrayBuffer, littleEndian: boolean, address: number, count: number): Float64Array {
  const out = new Float64Array(count);
  const view = new DataView(buffer);
  const offset = (address - 1) * 8;
  if (address < 1 || offset + count * 8 > buffer.byteLength) {
    throw new SpkReadError(`SPK element at address ${address} does not fit in the file`);
  }
  for (let i = 0; i < count; i += 1) out[i] = view.getFloat64(offset + i * 8, littleEndian);
  return out;
}
