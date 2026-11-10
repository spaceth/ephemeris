import { useState } from "react";
import type { CSSProperties } from "react";
import { useEphemeris } from "./useEphemeris";
import { AppRoute } from "./view/AppRoute";
import logo from "../spaceth-dark.svg";

export function App() {
  const session = useEphemeris();
  const [chrome, setChrome] = useState<CSSProperties>({});

  return (
    <div
      className="app"
      style={chrome}
      onDragEnter={session.onDragEnter}
      onDragOver={session.onDragOver}
      onDragLeave={session.onDragLeave}
      onDrop={session.onDrop}
    >
      <AppRoute session={session} onChrome={setChrome} />
      <div className="wordmark"><img src={logo} alt="Spaceth" /></div>
      {session.dragOver && <div className="drop">Drop an OEM</div>}
    </div>
  );
}
