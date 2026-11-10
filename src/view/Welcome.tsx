import type { ChangeEvent } from "react";

type Example = { id: string; label: string };

export function Welcome({
  examples,
  loading,
  error,
  webgl,
  onPick,
  onExample,
}: {
  examples: readonly Example[];
  loading: boolean;
  error: string | null;
  webgl: boolean;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  onExample: (id: string) => void;
}) {
  return (
    <div className="welcome material">
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
          <p>OEM 2.0 and 3.0, KVN or XML. Earth center, EME2000 or GCRF.</p>
        </div>
        <div className="welcome-col">
          <h2>Select from example</h2>
          <label className="field">
            <select
              value=""
              disabled={loading}
              aria-label="Select from example"
              onChange={(event) => {
                const id = event.target.value;
                if (id) onExample(id);
              }}
            >
              <option value="">Choose an example</option>
              {examples.map((example) => (
                <option key={example.id} value={example.id}>{example.label}</option>
              ))}
            </select>
          </label>
          <p>EM-2, an Earth-centered EME2000 ephemeris.</p>
        </div>
      </div>
      {loading && <p className="meta">Reading…</p>}
      {error && <p className="fail" role="alert">{error}</p>}
      {!webgl && <p className="note">WebGL is unavailable. Metadata still runs.</p>}
    </div>
  );
}
