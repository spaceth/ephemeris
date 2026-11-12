import { Zip, ZipPassThrough } from "fflate";
import type { CaptureHandle } from "./CaptureBridge";
import { downloadBlob, frameFileName, SEQUENCE_HEIGHT, SEQUENCE_WIDTH } from "./capture";

/** Copies each frame into one zip, then downloads it. Returns false when cancelled. */
export async function exportSequence(options: {
  capture: CaptureHandle;
  times: number[];
  name: string;
  seek: (seconds: number) => void;
  onFrame: (done: number, total: number) => void;
  cancelled: () => boolean;
}): Promise<boolean> {
  const { capture, times, name, seek, onFrame, cancelled } = options;
  if (times.length === 0) return false;
  const archive = createArchive();
  let begun = false;
  try {
    capture.begin(SEQUENCE_WIDTH, SEQUENCE_HEIGHT);
    begun = true;
    for (let index = 0; index < times.length; index += 1) {
      if (cancelled()) return false;
      onFrame(index + 1, times.length);
      seek(times[index]);
      const blob = await readFrame(capture, cancelled);
      if (!blob) return false;
      archive.add(frameFileName(index), new Uint8Array(await blob.arrayBuffer()));
    }
    if (cancelled()) return false;
    const packed = archive.finish();
    const buffer = new ArrayBuffer(packed.byteLength);
    new Uint8Array(buffer).set(packed);
    downloadBlob(new Blob([buffer], { type: "application/zip" }), name);
    return true;
  } finally {
    if (begun) capture.end();
  }
}

async function readFrame(capture: CaptureHandle, cancelled: () => boolean): Promise<Blob | null> {
  try {
    const blob = await capture.grab();
    if (cancelled()) return null;
    return blob;
  } catch (error) {
    if (cancelled() || (error instanceof Error && error.message === "Capture ended.")) return null;
    throw error;
  }
}

function createArchive(): { add: (name: string, bytes: Uint8Array) => void; finish: () => Uint8Array } {
  const parts: Uint8Array[] = [];
  let fault: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) {
      fault = new Error(err.message || "The frames could not be packed.");
      return;
    }
    if (data.length > 0) parts.push(data.slice());
  });
  return {
    add(name, bytes) {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(bytes, true);
      if (fault) throw fault;
    },
    finish() {
      zip.end();
      if (fault) throw fault;
      return concat(parts);
    },
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
