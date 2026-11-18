import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { covers, liveSeconds, orbitCenter } from "../core";
import { BODY_LABEL_COUNT } from "../core/ephemeris/bodies";
import { displayedState } from "../core/ephemeris/craft";
import { arcsForCenter } from "../session";
import type { EphemerisSession } from "../useEphemeris";
import { Clock } from "./Clock";
import type { CaptureHandle } from "./CaptureBridge";
import {
  EXPORT_FRAME_CAP,
  downloadBlob,
  frameStep,
  frameTimes,
  nextWindow,
  sequenceName,
  stillName,
  STILL_HEIGHT,
  STILL_WIDTH,
  windowEnd,
} from "./capture";
import { exportSequence } from "./exportFrames";
import { FlareControls } from "./FlareControls";
import { FLARE_DEBUG, loadFlareTune } from "./flareTune";
import type { FlareTune } from "./flareTune";
import { EphemerisPanel } from "./EphemerisPanel";
import { LeaveMenu } from "./LeaveMenu";
import type { TrajectoryLine } from "./OrbitView";
import { Visualization } from "./Visualization";
import { DEFAULT_LABELS } from "./Visualization";
import { DEFAULT_ORBITS, SOLAR_ORBITS } from "./orbitTrack";
import type { OrbitLineId, OrbitToggles } from "./orbitTrack";
import type { LabelKind, LabelToggles, RenderStyle } from "./Visualization";
import type { CameraFocus, CameraMode } from "./camera";
import { defaultFocus, focusFromLabel } from "./camera";
import { trajectoryRadius } from "./sceneFit";
import { SOLAR_FILE, SOLAR_OVERVIEW_KM, solarSeconds } from "./solar";
import type { ViewGate } from "./useViewGate";
import { formatEpoch, readableUtc } from "./format";

const OrbitView = lazy(() => import("./OrbitView").then((mod) => ({ default: mod.OrbitView })));

const LIVE_WINDOW = 1.5;

/** Fetches the WebGL viewer ahead of the opening transition. */
export function preloadViewer(): void {
  void import("./OrbitView");
}

export function Viewer({
  session,
  gate,
  onChrome,
}: {
  session: EphemerisSession;
  gate: Extract<ViewGate, "open" | "view">;
  onChrome: (style: CSSProperties) => void;
}) {
  const file = session.file;
  const solarMode = session.solar && !file;
  const shownArcs = useMemo(
    () => (file ? arcsForCenter(file, session.arcs, session.segment) : []),
    [file, session.arcs, session.segment],
  );
  const fit = useMemo(() => trajectoryRadius(shownArcs), [shownArcs]);
  const shown = file?.segments[session.segment];
  const center = shown ? orbitCenter(shown.centerName) : null;
  const bodyRadiusKm = center?.radiusKm ?? null;
  const [panelOpen, setPanelOpen] = useState(true);
  const [clockOpen, setClockOpen] = useState(true);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const [vizOpen, setVizOpen] = useState(false);
  const [trajectoryLine, setTrajectoryLine] = useState<TrajectoryLine>("all");
  const [trajectoryColor, setTrajectoryColor] = useState("#ffffff");
  const [orbits, setOrbits] = useState<OrbitToggles>(solarMode ? SOLAR_ORBITS : DEFAULT_ORBITS);
  const [labels, setLabels] = useState<LabelToggles>(DEFAULT_LABELS);
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("minimal");
  const [clouds, setClouds] = useState(true);
  const [minimalStars, setMinimalStars] = useState(false);
  const [realisticStars, setRealisticStars] = useState(true);
  const stars = renderStyle === "realistic" ? realisticStars : minimalStars;
  const [panelHeight, setPanelHeight] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [focus, setFocus] = useState<CameraFocus>({ kind: "craft" });
  useEffect(() => {
    setFocus(defaultFocus(Boolean(file)));
  }, [file, solarMode]);
  const selectFocus = (next: CameraFocus) => {
    setFocus(next);
    setCameraMode((mode) => (mode === "overview" ? "follow" : mode));
  };
  const centerLabelEl = useRef<HTMLSpanElement>(null);
  const objectLabelEl = useRef<HTMLSpanElement>(null);
  const constellationNames = useRef<HTMLDivElement>(null);
  const neighborLabelEls = useMemo(() => {
    const slots: RefObject<HTMLSpanElement | null>[] = [];
    for (let index = 0; index < BODY_LABEL_COUNT; index += 1) slots.push({ current: null });
    return slots;
  }, []);
  const storedTune = useRef<FlareTune | null>(null);
  if (storedTune.current == null) storedTune.current = loadFlareTune();
  const flareTuneRef = storedTune as RefObject<FlareTune>;
  const captureRef = useRef<CaptureHandle | null>(null);
  const cancelRef = useRef(false);
  const runRef = useRef(0);
  const busyRef = useRef(false);
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  const spanRef = useRef(session.span);
  spanRef.current = session.span;

  useEffect(() => {
    const coverage = spanRef.current;
    setTrim((current) => {
      if (!current || !coverage) return current;
      const end = windowEnd(current.start, frameStep(session.speed), coverage.stop);
      return end === current.end ? current : { start: current.start, end };
    });
  }, [session.speed]);

  useEffect(() => {
    setOrbits(solarMode ? SOLAR_ORBITS : DEFAULT_ORBITS);
  }, [solarMode]);

  useEffect(() => {
    setTrim(null);
    setProgress(null);
    cancelRef.current = true;
  }, [file]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const apply = () => setNarrow(query.matches);
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (solarMode) {
      onChrome({});
      return () => onChrome({});
    }
    const style = {
      "--sheet": panelOpen ? (narrow ? "58%" : "70%") : "120px",
      ...(panelHeight > 0 ? { "--panel-h": `${panelHeight}px` } : {}),
    } as CSSProperties;
    onChrome(style);
    return () => onChrome({});
  }, [narrow, onChrome, panelHeight, panelOpen, solarMode]);

  const state = file ? displayedState(file, session.t, session.segment) : null;
  const stateNote = gate === "view" && state && !state.ok ? state.message : null;
  const heldNote = useHeldNote(stateNote);

  if (!file && !solarMode) return null;

  const clockFile = solarMode ? SOLAR_FILE : file;
  const utc = clockFile ? formatEpoch(clockFile, session.t) : null;
  const liveAt = file ? liveSeconds(file, session.now) : solarSeconds(session.now);
  const showingLive = liveAt != null && Math.abs(session.t - liveAt) <= LIVE_WINDOW;
  const covering = file ? file.segments.filter((item) => covers(item, session.t)) : [];
  const readableTime = utc ? (readableUtc(utc.text) ?? utc.text) : "—";
  const isoTime = utc?.text ?? null;
  const timeNote = utc?.dubious ? "· leap table expired" : null;
  const viewing = gate === "view";
  const exportStep = frameStep(session.speed);
  const exportFrames = trim ? frameTimes(trim.start, trim.end, exportStep) : [];

  async function shoot() {
    const capture = captureRef.current;
    if (!capture || busyRef.current) {
      if (!capture) setCaptureNote("The view is not ready.");
      return;
    }
    busyRef.current = true;
    setCapturing(true);
    setCaptureNote(null);
    try {
      const blob = await capture.shot(STILL_WIDTH, STILL_HEIGHT);
      downloadBlob(blob, stillName(isoTime));
    } catch (error) {
      setCaptureNote(error instanceof Error ? error.message : "The screenshot could not be saved.");
    } finally {
      busyRef.current = false;
      setCapturing(false);
    }
  }

  function toggleTrim() {
    if (busyRef.current) return;
    if (trim) {
      setTrim(null);
      setCaptureNote(null);
      return;
    }
    const coverage = session.span;
    if (!coverage || coverage.stop <= coverage.start) return;
    const start = Math.min(coverage.stop, Math.max(coverage.start, session.t));
    setCaptureNote(null);
    setTrim({ start, end: windowEnd(start, exportStep, coverage.stop) });
  }

  async function saveFrames() {
    if (busyRef.current) return;
    const capture = captureRef.current;
    const window = trim;
    const coverage = session.span;
    if (!capture || !window || !coverage || !file) {
      setCaptureNote("The view is not ready.");
      return;
    }
    if (session.playing) session.togglePlay();
    const restore = session.clockRef.current.t;
    const times = frameTimes(window.start, window.end, exportStep);
    const id = runRef.current + 1;
    runRef.current = id;
    cancelRef.current = false;
    busyRef.current = true;
    setCapturing(true);
    setProgress({ done: 1, total: times.length });
    setCaptureNote(null);
    const stamp = formatEpoch(file, window.start)?.text ?? isoTime;
    try {
      const saved = await exportSequence({
        capture,
        times,
        name: sequenceName(stamp),
        seek: session.seek,
        onFrame: (done, total) => {
          if (runRef.current === id) setProgress({ done, total });
        },
        cancelled: () => cancelRef.current || runRef.current !== id,
      });
      if (saved && runRef.current === id) {
        setTrim(nextWindow(window.start, window.end, exportStep, coverage.stop, times.length));
      }
    } catch (error) {
      if (runRef.current === id) {
        setCaptureNote(error instanceof Error ? error.message : "The frames could not be saved.");
      }
    } finally {
      if (runRef.current === id) {
        busyRef.current = false;
        setCapturing(false);
        setProgress(null);
        session.seek(restore);
      }
    }
  }

  return (
    <>
      <div
        className={viewing ? "stage-wrap tool-enter" : "stage-wrap is-held"}
        onClick={(event) => {
          if (!(event.target instanceof Element)) return;
          const label = event.target.closest(".scene-label");
          if (!label || label.classList.contains("constellation-name")) return;
          const next = focusFromLabel(label.getAttribute("data-focus"), label.getAttribute("data-body-id"));
          if (next) selectFocus(next);
        }}
      >
        {session.webgl ? (
          <Suspense fallback={null}>
            <OrbitView
              arcs={solarMode ? [] : session.arcs}
              selected={session.segment}
              clock={session.clockRef}
              fit={solarMode ? SOLAR_OVERVIEW_KM : fit}
              centerName={solarMode ? "SUN" : center?.name ?? null}
              centerLabel={solarMode ? "Sun" : shown?.centerName ?? ""}
              objectLabel={solarMode ? "" : shown?.objectName ?? ""}
              trajectoryLine={trajectoryLine}
              trajectoryColor={trajectoryColor}
              orbits={orbits}
              labels={labels}
              realistic={renderStyle === "realistic"}
              clouds={clouds}
              stars={stars}
              centerLabelEl={centerLabelEl}
              objectLabelEl={objectLabelEl}
              constellationNames={constellationNames}
              bodyRadiusKm={solarMode ? orbitCenter("SUN")?.radiusKm ?? null : bodyRadiusKm}
              resetToken={session.resetToken}
              cameraMode={cameraMode}
              onCameraMode={setCameraMode}
              focus={focus}
              onFocus={selectFocus}
              neighborLabelEls={neighborLabelEls}
              flareTune={flareTuneRef}
              capture={captureRef}
              capturing={capturing}
            />
          </Suspense>
        ) : (
          <p className="banner">WebGL is unavailable. Metadata still runs.</p>
        )}
        <div ref={constellationNames} className="constellation-names" />
        <span ref={centerLabelEl} className="scene-label" data-focus="center">
          {solarMode ? "Sun" : shown?.centerName ?? ""}
        </span>
        <span ref={objectLabelEl} className="scene-label" data-focus="craft">
          {solarMode ? "" : shown?.objectName ?? ""}
        </span>
        {neighborLabelEls.map((slot, index) => (
          <span key={index} ref={slot} className="scene-label" />
        ))}
      </div>
      {heldNote && <p className="banner">{heldNote}</p>}
      {!viewing && (
        <div className="opening" role="status" aria-live="polite">
          <p>Opening</p>
          <span className="opening-track"><span className="opening-fill" /></span>
        </div>
      )}
      {viewing && <LeaveMenu onConfirm={session.closeFile} />}
      {viewing && file && (
        <EphemerisPanel
          file={file}
          fileName={session.fileName}
          segment={session.segment}
          covering={covering}
          loading={session.loading}
          error={session.error}
          open={panelOpen}
          onToggle={() => setPanelOpen((value) => !value)}
          onHeight={setPanelHeight}
        />
      )}
      {viewing && (
        <Clock
          file={clockFile ?? SOLAR_FILE}
          open={clockOpen}
          span={session.span}
          t={session.t}
          readableTime={readableTime}
          isoTime={isoTime}
          timeNote={timeNote}
          valueText={utc?.text ?? "No coverage"}
          playing={session.playing}
          speed={session.speed}
          webgl={session.webgl}
          liveEnabled={liveAt != null}
          showingLive={showingLive}
          onToggleOpen={() => setClockOpen((value) => !value)}
          onTogglePlay={session.togglePlay}
          onSeek={session.seek}
          onSpeed={session.setSpeed}
          onReset={() => {
            setCameraMode("overview");
            setFocus(defaultFocus(Boolean(file)));
            session.resetView();
          }}
          onLive={session.goLive}
          cameraMode={cameraMode}
          onCameraMode={setCameraMode}
          capture={{
            busy: capturing,
            progress,
            note: captureNote,
            trim,
            frames: exportFrames.length,
            maxSpan: exportStep * (EXPORT_FRAME_CAP - 1),
            onShot: () => void shoot(),
            onVideo: toggleTrim,
            onSave: () => void saveFrames(),
            onCancel: () => {
              cancelRef.current = true;
            },
            onTrim: (start, end) => setTrim({ start, end }),
          }}
        />
      )}
      {FLARE_DEBUG && viewing && session.webgl && (
        <FlareControls tune={flareTuneRef} realistic={renderStyle === "realistic"} />
      )}
      {viewing && (
        <Visualization
          open={vizOpen}
          line={trajectoryLine}
          color={trajectoryColor}
          labels={labels}
          orbits={orbits}
          showTrajectory={!solarMode}
          renderStyle={renderStyle}
          clouds={clouds}
          stars={stars}
          onToggle={() => setVizOpen((value) => !value)}
          onLine={setTrajectoryLine}
          onColor={setTrajectoryColor}
          onLabel={(kind: LabelKind) => setLabels((current) => ({ ...current, [kind]: !current[kind] }))}
          onOrbit={(id: OrbitLineId) => setOrbits((current) => ({ ...current, [id]: !current[id] }))}
          onRenderStyle={setRenderStyle}
          onClouds={() => setClouds((value) => !value)}
          onStars={() => {
            if (renderStyle === "realistic") setRealisticStars((value) => !value);
            else setMinimalStars((value) => !value);
          }}
        />
      )}
    </>
  );
}

/** A segment handoff is shorter than this. A miss that stays is shown. */
const BANNER_HOLD_MS = 500;

function useHeldNote(message: string | null): string | null {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (message == null) {
      setReady(null);
      return;
    }
    const timer = window.setTimeout(() => setReady(message), BANNER_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [message]);
  if (message == null || ready !== message) return null;
  return message;
}
