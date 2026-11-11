import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { covers, liveSeconds, orbitCenter, stateAt } from "../core";
import { arcsForCenter } from "../session";
import type { EphemerisSession } from "../useEphemeris";
import { Clock } from "./Clock";
import { EphemerisPanel } from "./EphemerisPanel";
import { LeaveMenu } from "./LeaveMenu";
import type { TrajectoryLine } from "./OrbitView";
import { Visualization } from "./Visualization";
import type { NameDisplay } from "./Visualization";
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
  const [nameDisplay, setNameDisplay] = useState<NameDisplay>("shown");
  const [panelHeight, setPanelHeight] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const centerLabelEl = useRef<HTMLSpanElement>(null);
  const objectLabelEl = useRef<HTMLSpanElement>(null);

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
  const state = stateAt(file, session.t, session.segment);
  const liveAt = liveSeconds(file, session.now);
  const showingLive = liveAt != null && Math.abs(session.t - liveAt) <= LIVE_WINDOW;
  const covering = file.segments.filter((item) => covers(item, session.t));
  const readableTime = utc ? (readableUtc(utc.text) ?? utc.text) : "—";
  const isoTime = utc?.text ?? null;
  const timeNote = utc?.dubious ? "· leap table expired" : null;
  const viewing = gate === "view";

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
              showNames={nameDisplay === "shown"}
              centerLabelEl={centerLabelEl}
              objectLabelEl={objectLabelEl}
              bodyRadiusKm={bodyRadiusKm}
              resetToken={session.resetToken}
              cameraMode={cameraMode}
              onCameraMode={setCameraMode}
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
        />
      )}
      {viewing && (
        <Visualization
          open={vizOpen}
          line={trajectoryLine}
          color={trajectoryColor}
          names={nameDisplay}
          onToggle={() => setVizOpen((value) => !value)}
          onLine={setTrajectoryLine}
          onColor={setTrajectoryColor}
          onNames={setNameDisplay}
        />
      )}
    </>
  );
}
