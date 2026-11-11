import { useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ChevronIcon } from "./icons";
import { useDismiss } from "./useDismiss";

type Example = { id: string; label: string };

export function Welcome({
  examples,
  loading,
  error,
  webgl,
  onPick,
  onExample,
  leaving,
}: {
  examples: readonly Example[];
  loading: boolean;
  error: string | null;
  webgl: boolean;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  onExample: (id: string) => void;
  leaving: boolean;
}) {
  return (
    <div className={leaving ? "welcome material is-leaving" : "welcome material"}>
      <div className="tight">
        <h1>Ephemeris Visualization</h1>
        <p>Upload a CCSDS OEM, or start from an example.</p>
      </div>
      <p className="welcome-about">
        Plot spacecraft trajectory. Play or scrub the ephemeris. Visualize the state vector, or just help plan your space mission.
      </p>
      <div className="welcome-actions">
        <p className="welcome-kicker">You can</p>
        <div className="welcome-col">
          <h2>Upload ephemeris</h2>
          <label className="round-control pressable file-btn">
            Upload
            <input className="sr" type="file" accept=".oem,.xml,.txt,.kvn" aria-label="Upload ephemeris" onChange={onPick} />
          </label>
          <p>OEM 2.0 and 3.0, KVN or XML. EME2000, GCRF, or ICRF about a SANA orbit center.</p>
        </div>
        <div className="welcome-col">
          <h2>Select from example</h2>
          <ExamplePicker examples={examples} loading={loading} onExample={onExample} />
          <p>EM-2, ISS, and CE7, Earth-centered EME2000 ephemerides. LRO, Moon-centered EME2000. DART, Earth then Sun in ICRF.</p>
        </div>
      </div>
      {loading && <p className="meta">Reading…</p>}
      {error && <p className="fail" role="alert">{error}</p>}
      {!webgl && <p className="note">WebGL is unavailable. Metadata still runs.</p>}
    </div>
  );
}

function ExamplePicker({
  examples,
  loading,
  onExample,
}: {
  examples: readonly Example[];
  loading: boolean;
  onExample: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDismiss(open, rootRef, setOpen);

  return (
    <div className={open ? "picker is-open" : "picker"} ref={rootRef}>
      <button
        type="button"
        className="picker-trigger pressable"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Select from example"
        disabled={loading}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Choose an example</span>
        <ChevronIcon className="picker-chevron" />
      </button>
      {open && (
        <ul className="picker-menu" id={listId} role="listbox" aria-label="Examples">
          {examples.map((example) => (
            <li key={example.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="picker-option"
                onClick={() => {
                  setOpen(false);
                  onExample(example.id);
                }}
              >
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
