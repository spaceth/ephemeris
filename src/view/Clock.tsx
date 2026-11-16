import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, InputEvent as ReactInputEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { OemFile } from "../core";
import { CameraPicker } from "./CameraPicker";
import type { CameraMode } from "./camera";
import { moveTrim } from "./capture";
import { CameraIcon, FramesIcon, PauseIcon, PlayIcon } from "./icons";
import { HideButton } from "./HideButton";
import { useBoxMotion } from "./useBoxMotion";
import { ISO_EDIT_MASK, ISO_EDIT_WIDTH, ISO_UTC_WIDTH, READABLE_UTC_WIDTH, isoEditValue, isoMaskArrow, isoMaskBackspace, isoMaskDelete, isoMaskPaste, isoMaskSnap, utcTextToSeconds } from "./format";
import { playbackSpeeds, spanPace, speedLabel } from "./speeds";

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
  const spanSeconds = coverage ? coverage.stop - coverage.start : 0;
  const speeds = useMemo(() => playbackSpeeds(spanSeconds), [spanSeconds]);
  useEffect(() => {
    if (!speeds.includes(speed)) onSpeed(speeds[0] ?? 1);
  }, [onSpeed, speed, speeds]);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const draftRef = useRef("");
  const tookInput = useRef(false);
  const [arrived, setArrived] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  draftRef.current = draft;
  useBoxMotion(open, rootRef);
  useEffect(() => {
    if (!editing) return;
    timeInputRef.current?.focus();
    timeInputRef.current?.select();
  }, [editing]);
  useLayoutEffect(() => {
    if (!editing) return;
    const node = timeInputRef.current;
    const caret = caretRef.current;
    if (!node || caret == null) return;
    node.setSelectionRange(caret, caret);
  }, [draft, editing]);
  useEffect(() => {
    const node = timeInputRef.current;
    if (!editing || !node) return;
    const onBefore = (event: InputEvent) => {
      if (tookInput.current) {
        event.preventDefault();
        return;
      }
      const kind = event.inputType;
      if (kind === "insertLineBreak" || kind === "insertParagraph") return;
      const start = node.selectionStart ?? 0;
      const end = node.selectionEnd ?? start;
      const text = draftRef.current;
      if (kind === "insertFromPaste" || kind === "insertFromDrop") {
        event.preventDefault();
        return;
      }
      if (kind === "insertText" || kind === "insertCompositionText" || kind === "insertReplacementText") {
        event.preventDefault();
        putMask(isoMaskPaste(text, start, end, event.data ?? ""));
        return;
      }
      if (kind === "deleteContentForward") {
        event.preventDefault();
        putMask(isoMaskDelete(text, start, end));
        return;
      }
      if (kind.startsWith("delete")) {
        event.preventDefault();
        putMask(isoMaskBackspace(text, start, end));
        return;
      }
      if (kind.startsWith("insert")) event.preventDefault();
    };
    node.addEventListener("beforeinput", onBefore);
    return () => node.removeEventListener("beforeinput", onBefore);
  }, [editing]);

  function beginEdit() {
    if (!isoTime || !coverage || capture.busy) return;
    if (playing) onTogglePlay();
    caretRef.current = null;
    setDraft(isoEditValue(isoTime));
    setEditError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditError(null);
  }

  function commitEdit(event: FormEvent) {
    event.preventDefault();
    if (!file.origin || !coverage) return;
    let seconds: number;
    try {
      seconds = utcTextToSeconds(file.origin, draft);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setEditError(message.startsWith("Epoch") ? "Enter a UTC time, YYYY-MM-DDThh:mm:ss" : "That UTC time cannot be used");
      return;
    }
    if (seconds < coverage.start - 1e-3 || seconds > coverage.stop + 1e-3) {
      setEditError("Outside this ephemeris");
      return;
    }
    onSeek(seconds);
    setEditing(false);
    setEditError(null);
  }

  function putMask(next: { text: string; caret: number }) {
    tookInput.current = true;
    caretRef.current = next.caret;
    setDraft(next.text);
    setEditError(null);
    queueMicrotask(() => {
      tookInput.current = false;
    });
  }

  function editBounds(): { start: number; end: number } {
    const node = timeInputRef.current;
    const start = node?.selectionStart ?? 0;
    const end = node?.selectionEnd ?? start;
    return { start, end };
  }

  function onEditKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const { start, end } = editBounds();
    if (event.key === "Backspace") {
      event.preventDefault();
      putMask(isoMaskBackspace(draft, start, end));
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      putMask(isoMaskDelete(draft, start, end));
      return;
    }
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      putMask(isoMaskPaste(draft, start, end, event.key));
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.shiftKey || start !== end) return;
    const next = isoMaskArrow(start, event.key === "ArrowRight" ? 1 : -1);
    if (next === start) return;
    event.preventDefault();
    event.currentTarget.setSelectionRange(next, next);
  }

  function onEditBeforeInput(event: ReactInputEvent<HTMLInputElement>) {
    if (tookInput.current) {
      event.preventDefault();
      return;
    }
    const data = event.data ?? "";
    if (!data) return;
    event.preventDefault();
    const { start, end } = editBounds();
    putMask(isoMaskPaste(draft, start, end, data));
  }

  function onEditPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    if (tookInput.current) return;
    const { start, end } = editBounds();
    putMask(isoMaskPaste(draft, start, end, event.clipboardData.getData("text")));
  }

  function onEditDrop(event: DragEvent<HTMLInputElement>) {
    event.preventDefault();
    if (tookInput.current) return;
    const { start, end } = editBounds();
    putMask(isoMaskPaste(draft, start, end, event.dataTransfer.getData("text")));
  }

  function onEditChange(event: ChangeEvent<HTMLInputElement>) {
    if (tookInput.current) return;
    const native = event.nativeEvent;
    if (!(native instanceof InputEvent) || !native.data) return;
    const next = event.target.value;
    const caret = event.target.selectionStart ?? next.length;
    const removed = draft.length - next.length + native.data.length;
    const start = Math.max(0, caret - native.data.length);
    putMask(isoMaskPaste(draft, start, start + Math.max(0, removed), native.data));
  }

  function onEditSelect(event: { currentTarget: HTMLInputElement }) {
    const node = event.currentTarget;
    const start = node.selectionStart ?? 0;
    const end = node.selectionEnd ?? start;
    if (start !== end) return;
    const snapped = isoMaskSnap(start);
    if (snapped !== start) node.setSelectionRange(snapped, snapped);
  }
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
            <span className="clock-iso-line">
              {editing ? (
                <span className="clock-iso-edit">
                  <form className="clock-iso-form" onSubmit={commitEdit}>
                    <span className={editError ? "clock-iso-field nums is-invalid" : "clock-iso-field nums"}>
                      <span className="clock-sizer" aria-hidden="true">
                        <span className="clock-sizer-line">{ISO_EDIT_MASK}</span>
                        <span className="clock-sizer-line">{ISO_EDIT_WIDTH}</span>
                      </span>
                      <input
                        ref={timeInputRef}
                        className="clock-iso-input"
                        aria-label="UTC time, YYYY-MM-DDThh:mm:ss"
                        aria-invalid={editError != null}
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        value={draft}
                        onKeyDown={onEditKeyDown}
                        onBeforeInput={onEditBeforeInput}
                        onPaste={onEditPaste}
                        onDrop={onEditDrop}
                        onSelect={onEditSelect}
                        onChange={onEditChange}
                      />
                    </span>
                    <button type="submit" className="round-control pressable clock-edit">Set</button>
                  </form>
                  {editError && <span className="clock-note clock-edit-error" role="alert">{editError}</span>}
                </span>
              ) : (
                <>
                  <button type="button" className="clock-iso nums" title="Copy UTC time" onClick={() => void navigator.clipboard.writeText(isoTime)}>
                    <span className="clock-sizer" aria-hidden="true">{ISO_UTC_WIDTH}</span>
                    <span>{isoTime}</span>
                  </button>
                  <button
                    type="button"
                    className="round-control pressable clock-edit"
                    aria-label="Edit date and time"
                    disabled={!coverage || capture.busy}
                    onClick={beginEdit}
                  >
                    Edit
                  </button>
                </>
              )}
            </span>
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
            {speeds.map((value) => (
              <button
                type="button"
                key={value}
                className="round-control pressable nums"
                aria-pressed={speed === value}
                title={spanSeconds > 0 ? `Full span in ${spanPace(spanSeconds, value)}` : undefined}
                onClick={() => onSpeed(value)}
              >
                {speedLabel(value)}
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
