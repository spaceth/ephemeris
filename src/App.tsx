import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { covers, liveSeconds, stateAt } from "./core";
import { EXAMPLES, useEphemeris } from "./useEphemeris";
import { Clock } from "./view/Clock";
import { HideButton } from "./view/HideButton";
import { Metadata, MinimalMeta } from "./view/Metadata";
import { OrbitView, trajectoryRadius } from "./view/OrbitView";
import { Welcome } from "./view/Welcome";
import { formatEpoch } from "./view/format";
import logo from "../spaceth-dark.svg";

const LIVE_WINDOW = 1.5;

export function App() {
  const session = useEphemeris();
  const [panelOpen, setPanelOpen] = useState(true);
  const [clockOpen, setClockOpen] = useState(true);
  const panelRef = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);

  const file = session.file;
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const measure = () => setPanelHeight(node.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [file]);

  const utc = file ? formatEpoch(file, session.t) : null;
  const state = file ? stateAt(file, session.t, session.segment) : null;
  const liveAt = file ? liveSeconds(file, session.now) : null;
  const showingLive = liveAt != null && Math.abs(session.t - liveAt) <= LIVE_WINDOW;
  const covering = file ? file.segments.filter((item) => covers(item, session.t)) : [];
  const sheet = panelOpen ? "70%" : "120px";
  const timeText = utc ? `${utc.text}${utc.dubious ? " · leap table expired" : ""}` : "—";

  return (
    <div
      className="app"
      style={{ "--sheet": sheet, ...(panelHeight > 0 ? { "--panel-h": `${panelHeight}px` } : {}) } as CSSProperties}
      onDragEnter={session.onDragEnter}
      onDragOver={session.onDragOver}
      onDragLeave={session.onDragLeave}
      onDrop={session.onDrop}
    >
      {file ? (
        <div className="stage-wrap">
          {session.webgl ? (
            <OrbitView
              arcs={session.arcs}
              selected={session.segment}
              clock={session.clockRef}
              fit={trajectoryRadius(session.arcs)}
              resetToken={session.resetToken}
            />
          ) : (
            <p className="banner">WebGL is unavailable. Metadata still runs.</p>
          )}
        </div>
      ) : (
        <div className="welcome-bg" />
      )}
      {file && state && !state.ok && <p className="banner">{state.message}</p>}

      <div className="wordmark"><img src={logo} alt="Spaceth" /></div>

      {file && (
        <aside ref={panelRef} className={panelOpen ? "panel material" : "panel material is-collapsed"}>
          <div className="box-head">
            <h2 className="box-title">Ephemeris</h2>
            <HideButton open={panelOpen} label="metadata" onClick={() => setPanelOpen((value) => !value)} />
          </div>
          {session.loading && <p className="meta">Reading…</p>}
          {session.error && <p className="fail" role="alert">{session.error}</p>}
          <div className="box-body">
            {panelOpen ? (
              <Metadata
                file={file}
                fileName={session.fileName}
                segment={session.segment}
                covering={covering}
                onSelectSegment={session.setSegment}
              />
            ) : (
              <MinimalMeta file={file} fileName={session.fileName} segment={session.segment} />
            )}
          </div>
        </aside>
      )}

      {file && (
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
          onReset={session.resetView}
          onLive={session.goLive}
        />
      )}

      {!file && (
        <Welcome
          examples={EXAMPLES}
          loading={session.loading}
          error={session.error}
          webgl={session.webgl}
          onPick={(event) => void session.onPick(event)}
          onExample={(id) => void session.loadExample(id)}
        />
      )}
      {session.dragOver && <div className="drop">Drop an OEM</div>}
    </div>
  );
}
