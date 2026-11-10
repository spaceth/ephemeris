import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { covers, liveSeconds, stateAt } from "../core";
import type { EphemerisSession } from "../useEphemeris";
import { Clock } from "./Clock";
import { EphemerisPanel } from "./EphemerisPanel";
import { LeaveMenu } from "./LeaveMenu";
import type { CameraMode } from "./camera";
import { trajectoryRadius } from "./sceneFit";
import type { ViewGate } from "./useViewGate";
import { formatEpoch } from "./format";

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
  const fit = useMemo(() => (file ? trajectoryRadius(session.arcs) : 0), [file, session.arcs]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [clockOpen, setClockOpen] = useState(true);
  const [panelHeight, setPanelHeight] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");

  useEffect(() => {
    const style = {
      "--sheet": panelOpen ? "70%" : "120px",
      ...(panelHeight > 0 ? { "--panel-h": `${panelHeight}px` } : {}),
    } as CSSProperties;
    onChrome(style);
    return () => onChrome({});
  }, [onChrome, panelHeight, panelOpen]);

  if (!file) return null;

  const utc = formatEpoch(file, session.t);
  const state = stateAt(file, session.t, session.segment);
  const liveAt = liveSeconds(file, session.now);
  const showingLive = liveAt != null && Math.abs(session.t - liveAt) <= LIVE_WINDOW;
  const covering = file.segments.filter((item) => covers(item, session.t));
  const timeText = utc ? `${utc.text}${utc.dubious ? " · leap table expired" : ""}` : "—";
  const viewing = gate === "view";

  return (
    <>
      <div className={viewing ? "stage-wrap tool-enter" : "stage-wrap is-held"}>
        {session.webgl ? (
          <Suspense fallback={null}>
            <OrbitView
              arcs={session.arcs}
              selected={session.segment}
              clock={session.clockRef}
              fit={fit}
              resetToken={session.resetToken}
              cameraMode={cameraMode}
              onCameraMode={setCameraMode}
            />
          </Suspense>
        ) : (
          <p className="banner">WebGL is unavailable. Metadata still runs.</p>
        )}
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
          onSelectSegment={session.setSegment}
          onHeight={setPanelHeight}
        />
      )}
      {viewing && (
        <Clock
          file={file}
          open={clockOpen}
          span={session.span}
          t={session.t}
          timeText={timeText}
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
    </>
  );
}
