import { useEffect } from "react";
import type { CSSProperties } from "react";
import { EXAMPLES } from "../useEphemeris";
import type { EphemerisSession } from "../useEphemeris";
import { preloadViewer, Viewer } from "./Viewer";
import { Welcome } from "./Welcome";
import { useViewGate } from "./useViewGate";

/** Welcome at rest, then the viewer once a file is open. The 3D scene stays in its own chunk. */
export function AppRoute({
  session,
  onChrome,
}: {
  session: EphemerisSession;
  onChrome: (style: CSSProperties) => void;
}) {
  const gate = useViewGate(session.file);
  const welcome = gate === "welcome" || gate === "leave";

  useEffect(() => {
    if (session.file || session.loading) preloadViewer();
  }, [session.file, session.loading]);

  useEffect(() => {
    const win = window;
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(preloadViewer);
      return () => win.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preloadViewer, 400);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      {welcome && <div className="welcome-bg" />}
      {!welcome && session.file && (gate === "open" || gate === "view") && (
        <Viewer session={session} gate={gate} onChrome={onChrome} />
      )}
      {welcome && (
        <Welcome
          examples={EXAMPLES}
          loading={session.loading}
          error={session.error}
          webgl={session.webgl}
          leaving={gate === "leave"}
          onPick={(event) => void session.onPick(event)}
          onExample={(id) => void session.loadExample(id)}
        />
      )}
    </>
  );
}
