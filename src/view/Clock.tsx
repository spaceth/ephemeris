import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { OemFile } from "../core";
import { CameraPicker } from "./CameraPicker";
import type { CameraMode } from "./camera";
import { moveTrim } from "./capture";
import { CameraIcon, FramesIcon, PauseIcon, PlayIcon } from "./icons";
import { HideButton } from "./HideButton";
import { useBoxMotion } from "./useBoxMotion";
import { ISO_UTC_WIDTH, READABLE_UTC_WIDTH } from "./format";

const SPEEDS = [1, 30, 120, 600, 3600] as const;

export function Clock({
  file,
  open,
  span,
  t,
  readableTime,
  isoTime,
  timeNote,
  valueText,
  playing,
  speed,
  webgl,
  liveEnabled,
  showingLive,
  onToggleOpen,
  onTogglePlay,
  onSeek,
  onSpeed,
  onReset,
  onLive,
  cameraMode,
  onCameraMode,
  capture,
}: {
  file: OemFile;
  open: boolean;
  span: { start: number; stop: number } | null;
  t: number;
  readableTime: string;
  isoTime: string | null;
  timeNote: string | null;
  valueText: string;
  playing: boolean;
  speed: number;
  webgl: boolean;
  liveEnabled: boolean;
  showingLive: boolean;
  onToggleOpen: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSpeed: (speed: number) => void;
  onReset: () => void;
  onLive: () => void;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
  capture: FrameCapture;
}) {
  const coverage = span && span.stop > span.start ? span : null;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const [arrived, setArrived] = useState(false);
  useBoxMotion(open, rootRef);
  const clockClass = ["clock", "material", open ? "" : "is-collapsed", arrived ? "" : "tool-enter"].filter(Boolean).join(" ");
  return (
    <div
      ref={rootRef}
      className={clockClass}
      onAnimationEnd={(event) => {
        if (event.animationName === "clock-in") setArrived(true);
      }}
    >
      <div className="box-head">
        <h2 className="box-title">Viewing</h2>
        {open && <CameraPicker mode={cameraMode} disabled={!webgl} onChange={onCameraMode} />}
        <HideButton open={open} label="viewing" onClick={onToggleOpen} />
      </div>
      <div className="clock-main">
        {open && (
          <button type="button" className="round-control pressable play-btn" aria-pressed={playing} aria-label={playing ? "Pause" : "Play"} aria-keyshortcuts="Space" onClick={onTogglePlay} disabled={!coverage}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        )}
        <span className="clock-times">
          <span className="clock-time nums">
            <span className="clock-sizer" aria-hidden="true">{READABLE_UTC_WIDTH}</span>
            <span>{readableTime}</span>
          </span>
          {isoTime && (
            <button type="button" className="clock-iso nums" onClick={() => void navigator.clipboard.writeText(isoTime)}>
              <span className="clock-sizer" aria-hidden="true">{ISO_UTC_WIDTH}</span>
              <span>{isoTime}</span>
            </button>
          )}
          {timeNote && <span className="clock-note nums">{timeNote}</span>}
        </span>
      </div>
      {open && (
        <div className="clock-rest">
          <div className="clock-row">
            <button type="button" className="round-control pressable" onClick={onReset} disabled={!webgl}>
              Reset
            </button>
            <button
              type="button"
              className={showingLive ? "round-control pressable live-btn is-live" : "round-control pressable live-btn"}
              onClick={onLive}
              disabled={!liveEnabled}
              title={liveEnabled ? "Jump to the current UTC" : "Current UTC is outside this ephemeris"}
            >
              <span className={showingLive ? "live-dot on" : "live-dot"} aria-hidden="true" />
              Live
            </button>
            {SPEEDS.map((value) => (
              <button type="button" key={value} className="round-control pressable" aria-pressed={speed === value} onClick={() => onSpeed(value)}>
                {value}×
              </button>
            ))}
            <div className="clock-capture">
              <button
                type="button"
                className="round-control pressable play-btn"
                aria-label="Screenshot"
                title="Screenshot"
                disabled={!webgl || capture.busy}
                onClick={capture.onShot}
              >
                <CameraIcon />
              </button>
              <button
                type="button"
                className="round-control pressable play-btn"
                aria-label="Video"
                title="Video"
                aria-pressed={capture.trim != null}
                disabled={!webgl || !coverage || capture.busy}
                onClick={capture.onVideo}
              >
                <FramesIcon />
              </button>
              {capture.trim && (
                <button
                  type="button"
                  className="round-control pressable nums"
                  onClick={capture.progress ? capture.onCancel : capture.onSave}
                  aria-label={capture.progress ? "Cancel" : `Save ${capture.frames} frames`}
                  title={capture.progress ? "Cancel" : `Save ${capture.frames} frames`}
                >
                  {capture.progress ? `${capture.progress.done} / ${capture.progress.total}` : "Save"}
                </button>
              )}
            </div>
          </div>
          {capture.note && <p className="capture-note">{capture.note}</p>}
          <div className="scrub" ref={scrubRef}>
            <div className="track" />
            {coverage && bands(file).map((band) => {
              const width = ((band.stop - band.start) / (coverage.stop - coverage.start)) * 100;
              const left = ((band.start - coverage.start) / (coverage.stop - coverage.start)) * 100;
              return <span key={`${band.start}-${band.stop}`} className="band" style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }} />;
            })}
            {coverage && capture.trim && (
              <Trimmer
                bounds={scrubRef}
                start={capture.trim.start}
                end={capture.trim.end}
                coverage={coverage}
                maxSpan={capture.maxSpan}
                frames={capture.frames}
                disabled={capture.busy}
                onChange={capture.onTrim}
              />
            )}
            <input
              type="range"
              aria-label="Simulation time"
              aria-valuetext={valueText}
              min={coverage?.start ?? 0}
              max={coverage?.stop ?? 1}
              step={coverage ? (coverage.stop - coverage.start) / 4000 : 1}
              value={coverage ? Math.min(coverage.stop, Math.max(coverage.start, t)) : 0}
              disabled={!coverage || capture.busy}
              onChange={(event) => onSeek(Number(event.target.value))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function bands(file: OemFile): { start: number; stop: number }[] {
  return file.segments
    .filter((segment) => segment.evalStart != null && segment.evalStop != null && segment.evalStop > segment.evalStart)
    .map((segment) => ({ start: segment.evalStart as number, stop: segment.evalStop as number }));
}

type FrameCapture = {
  busy: boolean;
  progress: { done: number; total: number } | null;
  note: string | null;
  trim: { start: number; end: number } | null;
  frames: number;
  maxSpan: number;
  onShot: () => void;
  onVideo: () => void;
  onSave: () => void;
  onCancel: () => void;
  onTrim: (start: number, end: number) => void;
};

function Trimmer({
  bounds,
  start,
  end,
  coverage,
  maxSpan,
  frames,
  disabled,
  onChange,
}: {
  bounds: RefObject<HTMLDivElement | null>;
  start: number;
  end: number;
  coverage: { start: number; stop: number };
  maxSpan: number;
  frames: number;
  disabled: boolean;
  onChange: (start: number, end: number) => void;
}) {
  const span = coverage.stop - coverage.start;
  const left = ((start - coverage.start) / span) * 100;
  const width = ((end - start) / span) * 100;

  function timeAt(clientX: number): number {
    const rect = bounds.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return start;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return coverage.start + ratio * span;
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, mode: "start" | "end" | "move") {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = timeAt(event.clientX);
    const baseStart = start;
    const baseEnd = end;
    const target = event.currentTarget;
    const drag = (pointer: PointerEvent) => {
      const next = moveTrim(mode, origin, timeAt(pointer.clientX), baseStart, baseEnd, coverage.start, coverage.stop, maxSpan);
      onChange(next.start, next.end);
    };
    const finish = (pointer: PointerEvent) => {
      if (target.hasPointerCapture(pointer.pointerId)) target.releasePointerCapture(pointer.pointerId);
      target.removeEventListener("pointermove", drag);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
    };
    target.addEventListener("pointermove", drag);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // A drag still follows the handle when the pointer cannot be captured.
    }
  }

  return (
    <div
      className="trimmer"
      style={{ left: `${left}%`, width: `${Math.max(width, 0)}%` }}
      aria-label={`${frames} frames`}
      onPointerDown={(event) => beginDrag(event, "move")}
    >
      <button type="button" className="trimmer-handle start" aria-label="Trim start" disabled={disabled} onPointerDown={(event) => beginDrag(event, "start")} />
      <button type="button" className="trimmer-handle end" aria-label="Trim end" disabled={disabled} onPointerDown={(event) => beginDrag(event, "end")} />
    </div>
  );
}
