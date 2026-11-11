/**
 * Build a little-endian DAF/SPK for tests. The layout matches the reader:
 * integer file record, one summary record, then element words.
 */

export type WrittenRecord = {
  mid: number;
  radius: number;
  /** Component-major coefficients, length `components * (degree + 1)`. */
  coefficients: number[];
};

export type WrittenSegment = {
  target: number;
  center: number;
  frame: number;
  type: number;
  startEt: number;
  stopEt: number;
  /** Required for types 2 and 3. Ignored for an unsupported type, which stores an empty element. */
  init?: number;
  intervalLength?: number;
  records?: WrittenRecord[];
};

const RECORD_BYTES = 1024;

function packInts(a: number, b: number): number {
  const bits = new ArrayBuffer(8);
  const view = new DataView(bits);
  view.setInt32(0, a, true);
  view.setInt32(4, b, true);
  return view.getFloat64(0, true);
}

export type SpkPart = {
  target: number;
  center: number;
  frame: number;
  type: number;
  startEt: number;
  stopEt: number;
  /** Element words, including a type 2 or 3 directory when those types are used. */
  element: Uint8Array;
};

/** Write a little-endian SPK from raw element bytes. One summary record, at most 25 segments. */
export function writeSpkParts(parts: readonly SpkPart[]): ArrayBuffer {
  if (parts.length > 25) throw new Error("This writer stores at most 25 SPK segments");
  const summaryRecords = 1;
  const dataRecord = 1 + summaryRecords + 1;
  let address = (dataRecord - 1) * 128 + 1;
  const placed = parts.map((part) => {
    if (part.element.byteLength % 8 !== 0) throw new Error("SPK element length must be a whole number of doubles");
    const words = part.element.byteLength / 8;
    const initialAddress = address;
    const finalAddress = address + words - 1;
    address = finalAddress + 1;
    return { part, initialAddress, finalAddress };
  });
  const records = Math.ceil((address - 1) / 128);
  const buffer = new ArrayBuffer(records * RECORD_BYTES);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set(new TextEncoder().encode("DAF/SPK "), 0);
  view.setInt32(8, 2, true);
  view.setInt32(12, 6, true);
  view.setInt32(76, 2, true);
  view.setInt32(80, 2, true);
  view.setInt32(84, address, true);
  bytes.set(new TextEncoder().encode("LTL-IEEE"), 88);
  const ftp = new Uint8Array([
    0x46, 0x54, 0x50, 0x53, 0x54, 0x52, 0x3a, 0x0d, 0x3a, 0x0a, 0x3a, 0x0d, 0x0a, 0x3a, 0x0d, 0x00, 0x3a, 0x81, 0x3a,
    0x10, 0xce, 0x3a, 0x45, 0x4e, 0x44, 0x46, 0x54, 0x50,
  ]);
  bytes.set(ftp, 699);
  const summary = RECORD_BYTES;
  view.setFloat64(summary, 0, true);
  view.setFloat64(summary + 8, 0, true);
  view.setFloat64(summary + 16, parts.length, true);
  placed.forEach((place, i) => {
    const at = summary + (3 + i * 5) * 8;
    view.setFloat64(at, place.part.startEt, true);
    view.setFloat64(at + 8, place.part.stopEt, true);
    view.setFloat64(at + 16, packInts(place.part.target, place.part.center), true);
    view.setFloat64(at + 24, packInts(place.part.frame, place.part.type), true);
    view.setFloat64(at + 32, packInts(place.initialAddress, place.finalAddress), true);
    bytes.set(place.part.element, (place.initialAddress - 1) * 8);
  });
  return buffer;
}

export function writeSpk(segments: readonly WrittenSegment[]): ArrayBuffer {
  const elementWords: number[][] = segments.map((segment) => {
    if (segment.type !== 2 && segment.type !== 3) return [0];
    const records = segment.records ?? [];
    if (records.length === 0 || segment.init == null || segment.intervalLength == null) {
      throw new Error("Type 2 and 3 test segments need records, init, and interval length");
    }
    const words: number[] = [];
    for (const record of records) {
      words.push(record.mid, record.radius, ...record.coefficients);
    }
    const recordSize = records[0] ? 2 + records[0].coefficients.length : 0;
    words.push(segment.init, segment.intervalLength, recordSize, records.length);
    return words;
  });
  const parts: SpkPart[] = segments.map((segment, i) => {
    const words = elementWords[i];
    const element = new Uint8Array(words.length * 8);
    const view = new DataView(element.buffer);
    words.forEach((word, index) => view.setFloat64(index * 8, word, true));
    return {
      target: segment.target,
      center: segment.center,
      frame: segment.frame,
      type: segment.type,
      startEt: segment.startEt,
      stopEt: segment.stopEt,
      element,
    };
  });
  return writeSpkParts(parts);
}
