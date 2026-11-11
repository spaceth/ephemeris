import { useRef, useState } from "react";
import type { TrajectoryLine } from "./OrbitView";
import { HideButton } from "./HideButton";
import { useBoxMotion } from "./useBoxMotion";

export type NameDisplay = "shown" | "hidden";

const LINES: { id: TrajectoryLine; label: string }[] = [
  { id: "all", label: "All" },
  { id: "trail", label: "Trail" },
  { id: "hidden", label: "Hidden" },
];

const NAMES: { id: NameDisplay; label: string }[] = [
  { id: "shown", label: "Shown" },
  { id: "hidden", label: "Hidden" },
];

/** `#RGB` and `#RRGGBB`, with or without the hash, as a six-digit CSS color. */
export function parseHex(value: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].replace(/./g, (digit) => digit + digit) : match[1];
  return `#${hex.toLowerCase()}`;
}

export function Visualization({
  open,
  line,
  color,
  names,
  onToggle,
  onLine,
  onColor,
  onNames,
}: {
  open: boolean;
  line: TrajectoryLine;
  color: string;
  names: NameDisplay;
  onToggle: () => void;
  onLine: (line: TrajectoryLine) => void;
  onColor: (color: string) => void;
  onNames: (names: NameDisplay) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [arrived, setArrived] = useState(false);
  const [text, setText] = useState("#fff");
  useBoxMotion(open, rootRef);
  const boxClass = ["visualization", "material", open ? "" : "is-collapsed", arrived ? "" : "tool-enter"].filter(Boolean).join(" ");

  return (
    <div
      ref={rootRef}
      className={boxClass}
      onAnimationEnd={(event) => {
        if (event.animationName === "viz-in" || event.animationName === "viz-in-top") setArrived(true);
      }}
    >
      <div className="box-head">
        <h2 className="box-title">Visualization</h2>
        <HideButton open={open} label="visualization" onClick={onToggle} />
      </div>
      {open && (
        <div className="viz-body">
          <section className="viz-group">
            <h3>Trajectory</h3>
            <div className="viz-field">
              <span id="viz-line">Line</span>
              <div className="viz-choices" role="group" aria-labelledby="viz-line">
                {LINES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="round-control pressable"
                    aria-pressed={line === item.id}
                    onClick={() => onLine(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="viz-field">
              <span>Color</span>
              <span className="viz-color">
                <span className="viz-swatch" style={{ background: color }} aria-hidden="true" />
                <input
                  className="viz-hex nums"
                  value={text}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  maxLength={7}
                  onChange={(event) => {
                    const next = event.target.value;
                    setText(next);
                    const parsed = parseHex(next);
                    if (parsed) onColor(parsed);
                  }}
                  onBlur={(event) => {
                    if (!parseHex(event.currentTarget.value)) setText(color === "#ffffff" ? "#fff" : color);
                  }}
                />
              </span>
            </label>
          </section>
          <section className="viz-group">
            <h3>Label</h3>
            <div className="viz-field">
              <span id="viz-names">Display Name</span>
              <div className="viz-choices" role="group" aria-labelledby="viz-names">
                {NAMES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="round-control pressable"
                    aria-pressed={names === item.id}
                    onClick={() => onNames(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
