import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { covers, liveSeconds, orbitCenter } from "../core";
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
import type { Clouds, NameDisplay, RenderStyle, Stars } from "./Visualization";
import type { CameraMode } from "./camera";
import { trajectoryRadius } from "./sceneFit";
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
  const shownArcs = useMemo(
    () => (file ? arcsForCenter(file, session.arcs, session.segment) : []),
    [file, session.arcs, session.segment],
  );
  const shown = file?.segments[session.segment];
  const center = shown ? orbitCenter(shown.centerName) : null;
  const bodyRadiusKm = center?.radiusKm ?? null;
  const fit = useMemo(() => trajectoryRadius(shownArcs), [shownArcs]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [clockOpen, setClockOpen] = useState(true);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const [vizOpen, setVizOpen] = useState(false);
  const [trajectoryLine, setTrajectoryLine] = useState<TrajectoryLine>("all");
  const [trajectoryColor, setTrajectoryColor] = useState("#ffffff");
  const [objectName, setObjectName] = useState<NameDisplay>("shown");
  const [bodyName, setBodyName] = useState<NameDisplay>("shown");
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("minimal");
  const [clouds, setClouds] = useState<Clouds>("on");
  const [stars, setStars] = useState<Stars>("on");
  const [panelHeight, setPanelHeight] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const centerLabelEl = useRef<HTMLSpanElement>(null);
  const objectLabelEl = useRef<HTMLSpanElement>(null);
  const neighborA = useRef<HTMLSpanElement>(null);
  const neighborB = useRef<HTMLSpanElement>(null);
  const neighborC = useRef<HTMLSpanElement>(null);
  const neighborLabelEls = useMemo(() => [neighborA, neighborB, neighborC], []);
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
    const style = {
      "--sheet": panelOpen ? (narrow ? "58%" : "70%") : "120px",
      ...(panelHeight > 0 ? { "--panel-h": `${panelHeight}px` } : {}),
    } as CSSProperties;
    onChrome(style);
    return () => onChrome({});
  }, [narrow, onChrome, panelHeight, panelOpen]);

  if (!file) return null;

  const utc = formatEpoch(file, session.t);
  const state = displayedState(file, session.t, session.segment);
  const liveAt = liveSeconds(file, session.now);
  const showingLive = liveAt != null && Math.abs(session.t - liveAt) <= LIVE_WINDOW;
  const covering = file.segments.filter((item) => covers(item, session.t));
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
      <div className={viewing ? "stage-wrap tool-enter" : "stage-wrap is-held"}>
        {session.webgl ? (
          <Suspense fallback={null}>
            <OrbitView
              arcs={shownArcs}
              selected={session.segment}
              clock={session.clockRef}
              fit={fit}
              centerName={center?.name ?? null}
              centerLabel={shown?.centerName ?? ""}
              objectLabel={shown?.objectName ?? ""}
              trajectoryLine={trajectoryLine}
              trajectoryColor={trajectoryColor}
              showBodyName={bodyName === "shown"}
              showObjectName={objectName === "shown"}
              realistic={renderStyle === "realistic"}
              clouds={clouds === "on"}
              stars={stars === "on"}
              centerLabelEl={centerLabelEl}
              objectLabelEl={objectLabelEl}
              bodyRadiusKm={bodyRadiusKm}
              resetToken={session.resetToken}
              cameraMode={cameraMode}
              onCameraMode={setCameraMode}
              neighborLabelEls={neighborLabelEls}
              flareTune={flareTuneRef}
              capture={captureRef}
              capturing={capturing}
            />
          </Suspense>
        ) : (
          <p className="banner">WebGL is unavailable. Metadata still runs.</p>
        )}
        <span ref={centerLabelEl} className="scene-label">
          {shown?.centerName ?? ""}
        </span>
        <span ref={objectLabelEl} className="scene-label">
          {shown?.objectName ?? ""}
        </span>
        <span ref={neighborA} className="scene-label" />
        <span ref={neighborB} className="scene-label" />
        <span ref={neighborC} className="scene-label" />
      </div>
      {viewing && !state.ok && <p className="banner">{state.message}</p>}
      {!viewing && (
        <div className="opening" role="status" aria-live="polite">
          <p>Opening</p>
          <span className="opening-track"><span className="opening-fill" /></span>
        </div>
      )}
      {viewing && <LeaveMenu onConfirm={session.closeFile} />}
      {viewing && (
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
          file={file}
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
          objectName={objectName}
          bodyName={bodyName}
          renderStyle={renderStyle}
          clouds={clouds}
          stars={stars}
          onToggle={() => setVizOpen((value) => !value)}
          onLine={setTrajectoryLine}
          onColor={setTrajectoryColor}
          onObjectName={setObjectName}
          onBodyName={setBodyName}
          onRenderStyle={setRenderStyle}
          onClouds={setClouds}
          onStars={setStars}
        />
      )}
    </>
  );
}
