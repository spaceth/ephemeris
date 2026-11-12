import { addAfterEffect, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export type CaptureSize = { width: number; height: number };

export type CaptureHandle = {
  /** Resize, copy one settled frame, then restore the live view. */
  shot: (width: number, height: number) => Promise<Blob>;
  /** Hold the drawing buffer at this size until `end`. */
  begin: (width: number, height: number) => void;
  /** Copy the next frame the composer (or the default pass) has drawn. */
  grab: () => Promise<Blob>;
  /** Restore the size from the matching `begin`. */
  end: () => void;
};

type SavedView = { width: number; height: number; dpr: number };

type Job = {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
  waited: number;
};

/**
 * Copies the WebGL canvas after the postprocessing pass.
 * The live canvas resets its pixel ratio on every React render, so a capture
 * reapplies the requested size at the start of each frame, before the composer draws.
 */
export function CaptureBridge({
  handle,
  exporting,
  labels,
}: {
  handle: RefObject<CaptureHandle | null>;
  exporting: RefObject<boolean>;
  /** Body, craft, and neighbor names. They are drawn onto the frame after the scene. */
  labels: readonly RefObject<HTMLElement | null>[];
}) {
  const get = useThree((state) => state.get);
  const setSize = useThree((state) => state.setSize);
  const setDpr = useThree((state) => state.setDpr);
  const gl = useThree((state) => state.gl);
  const target = useRef<CaptureSize | null>(null);
  const saved = useRef<SavedView | null>(null);
  const job = useRef<Job | null>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    let alive = true;
    const apply = (width: number, height: number) => {
      setDpr(1);
      setSize(width, height);
    };
    const api: CaptureHandle = {
      begin(width, height) {
        if (!alive) return;
        const state = get();
        if (!saved.current) {
          saved.current = { width: state.size.width, height: state.size.height, dpr: state.viewport.dpr };
        }
        target.current = { width, height };
        exporting.current = true;
        apply(width, height);
      },
      grab() {
        return new Promise<Blob>((resolve, reject) => {
          if (!alive) {
            reject(new Error("The view is not ready."));
            return;
          }
          const pending = job.current;
          if (pending) pending.reject(new Error("Capture was replaced."));
          job.current = { resolve, reject, waited: 0 };
        });
      },
      end() {
        const view = saved.current;
        target.current = null;
        exporting.current = false;
        saved.current = null;
        const pending = job.current;
        job.current = null;
        if (pending) pending.reject(new Error("Capture ended."));
        if (!alive || !view) return;
        setDpr(view.dpr);
        setSize(view.width, view.height);
      },
      async shot(width, height) {
        api.begin(width, height);
        try {
          return await api.grab();
        } finally {
          api.end();
        }
      },
    };
    handle.current = api;
    return () => {
      alive = false;
      handle.current = null;
      target.current = null;
      exporting.current = false;
      saved.current = null;
      const pending = job.current;
      job.current = null;
      if (pending) pending.reject(new Error("Capture ended."));
    };
  }, [exporting, get, handle, setDpr, setSize]);

  useFrame(() => {
    const goal = target.current;
    if (!goal) return;
    const state = get();
    if (state.size.width === goal.width && state.size.height === goal.height && state.viewport.dpr === 1) return;
    setDpr(1);
    setSize(goal.width, goal.height);
  }, -1);

  useEffect(() => {
    return addAfterEffect(() => {
      const pending = job.current;
      const goal = target.current;
      if (!pending || !goal) return;
      const buffer = gl.domElement;
      const state = get();
      const ready = state.viewport.dpr === 1 && buffer.width === goal.width && buffer.height === goal.height;
      if (!ready) {
        pending.waited += 1;
        if (pending.waited > 30) {
          job.current = null;
          pending.reject(new Error("The view could not be resized."));
        }
        return;
      }
      job.current = null;
      try {
        const copy = scratch.current ?? document.createElement("canvas");
        scratch.current = copy;
        copy.width = buffer.width;
        copy.height = buffer.height;
        const context = copy.getContext("2d");
        if (!context) throw new Error("The view could not be copied.");
        context.drawImage(buffer, 0, 0);
        paintLabels(context, labelsRef.current, goal.height, saved.current?.height ?? goal.height);
        copy.toBlob((blob) => {
          if (blob) pending.resolve(blob);
          else pending.reject(new Error("The view could not be encoded."));
        }, "image/png");
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error("The view could not be copied."));
      }
    });
  }, [get, gl]);

  return null;
}

/** The names sit above their screen point, centered, in the same proportion as the live view. */
function paintLabels(
  context: CanvasRenderingContext2D,
  labels: readonly RefObject<HTMLElement | null>[],
  exportHeight: number,
  liveHeight: number,
) {
  const scale = liveHeight > 0 ? exportHeight / liveHeight : 1;
  const gap = 8 * scale;
  for (const slot of labels) {
    const el = slot.current;
    if (!el || el.style.visibility === "hidden") continue;
    const text = el.textContent?.trim() ?? "";
    if (!text) continue;
    const placed = el.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
    if (!placed) continue;
    const x = Number(placed[1]);
    const y = Number(placed[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const computed = getComputedStyle(el);
    const liveSize = Number.parseFloat(computed.fontSize);
    const fontSize = (Number.isFinite(liveSize) ? liveSize : 10) * scale;
    const spacing = Number.parseFloat(computed.letterSpacing);
    context.save();
    context.font = `${computed.fontWeight} ${fontSize}px ${computed.fontFamily}`;
    context.fillStyle = computed.color;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.letterSpacing = Number.isFinite(spacing) ? `${spacing * scale}px` : computed.letterSpacing;
    context.fillText(text, x, y - gap);
    context.restore();
  }
}
