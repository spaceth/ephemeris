import type { OemFile } from "../core";
import { PauseIcon, PlayIcon } from "./icons";
import { HideButton } from "./HideButton";

const SPEEDS = [1, 30, 120, 600, 3600] as const;

export function Clock({
  file,
  open,
  span,
  t,
  timeText,
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
}: {
  file: OemFile;
  open: boolean;
  span: { start: number; stop: number } | null;
  t: number;
  timeText: string;
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
}) {
  const coverage = span && span.stop > span.start ? span : null;
  return (
    <div className={open ? "clock material" : "clock material is-collapsed"}>
      <div className="box-head">
        <h2 className="box-title">Time</h2>
        <HideButton open={open} label="time" onClick={onToggleOpen} />
      </div>
      <div className="clock-main">
        {open && (
          <button type="button" className="round-control pressable play-btn" aria-pressed={playing} aria-label={playing ? "Pause" : "Play"} aria-keyshortcuts="Space" onClick={onTogglePlay} disabled={!coverage}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        )}
        <span className="clock-time nums">{timeText}</span>
      </div>
      {open && (
        <div className="clock-rest">
          <div className="clock-row">
            <button type="button" className="round-control pressable" onClick={onReset} disabled={!webgl}>
              Reset
            </button>
            <button
              type="button"
              className="round-control pressable live-btn"
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
