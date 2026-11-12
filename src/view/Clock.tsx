import { useRef, useState } from "react";
import type { OemFile } from "../core";
import { CameraPicker } from "./CameraPicker";
import type { CameraMode } from "./camera";
import { PauseIcon, PlayIcon } from "./icons";
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
}) {
  const coverage = span && span.stop > span.start ? span : null;
  const rootRef = useRef<HTMLDivElement>(null);
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
          </div>
          <div className="scrub">
            <div className="track" />
            {coverage && bands(file).map((band) => {
              const width = ((band.stop - band.start) / (coverage.stop - coverage.start)) * 100;
              const left = ((band.start - coverage.start) / (coverage.stop - coverage.start)) * 100;
              return <span key={`${band.start}-${band.stop}`} className="band" style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }} />;
            })}
            <input
              type="range"
              aria-label="Simulation time"
              aria-valuetext={valueText}
              min={coverage?.start ?? 0}
              max={coverage?.stop ?? 1}
              step={coverage ? (coverage.stop - coverage.start) / 4000 : 1}
              value={coverage ? Math.min(coverage.stop, Math.max(coverage.start, t)) : 0}
              disabled={!coverage}
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
