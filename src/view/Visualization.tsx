import { useRef, useState } from "react";
import type { TrajectoryLine } from "./OrbitView";
import { HideButton } from "./HideButton";
import { useBoxMotion } from "./useBoxMotion";

export type NameDisplay = "shown" | "hidden";
export type RenderStyle = "minimal" | "realistic";
export type Clouds = "on" | "off";
export type Stars = "on" | "off";

const LINES: { id: TrajectoryLine; label: string }[] = [
  { id: "all", label: "All" },
  { id: "trail", label: "Trail" },
  { id: "short", label: "Short Trail" },
  { id: "hidden", label: "Hidden" },
];

const NAMES: { id: NameDisplay; label: string }[] = [
  { id: "shown", label: "Shown" },
  { id: "hidden", label: "Hidden" },
];

const STYLES: { id: RenderStyle; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "realistic", label: "Realistic" },
];

const CLOUDS: { id: Clouds; label: string }[] = [
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
];

const STARS: { id: Stars; label: string }[] = [
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
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
  objectName,
  bodyName,
  renderStyle,
  clouds,
  stars,
  onToggle,
  onLine,
  onColor,
  onObjectName,
  onBodyName,
  onRenderStyle,
  onClouds,
  onStars,
}: {
  open: boolean;
  line: TrajectoryLine;
  color: string;
  objectName: NameDisplay;
  bodyName: NameDisplay;
  renderStyle: RenderStyle;
  clouds: Clouds;
  stars: Stars;
  onToggle: () => void;
  onLine: (line: TrajectoryLine) => void;
  onColor: (color: string) => void;
  onObjectName: (names: NameDisplay) => void;
  onBodyName: (names: NameDisplay) => void;
  onRenderStyle: (style: RenderStyle) => void;
  onClouds: (clouds: Clouds) => void;
  onStars: (stars: Stars) => void;
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
            <h3>Realistic</h3>
            <div className="viz-choices" role="group" aria-label="Realistic">
              {STYLES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="round-control pressable"
                  aria-pressed={renderStyle === item.id}
                  onClick={() => onRenderStyle(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {renderStyle === "realistic" && (
              <>
              <div className="viz-field">
                <span id="viz-clouds">Cloud</span>
                <div className="viz-choices" role="group" aria-labelledby="viz-clouds">
                  {CLOUDS.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className="round-control pressable"
                      aria-pressed={clouds === item.id}
                      onClick={() => onClouds(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="viz-field">
                <span id="viz-stars">Stars</span>
                <div className="viz-choices" role="group" aria-labelledby="viz-stars">
                  {STARS.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className="round-control pressable"
                      aria-pressed={stars === item.id}
                      onClick={() => onStars(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              </>
            )}
          </section>
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
              <span id="viz-object-name">Object Name</span>
              <div className="viz-choices" role="group" aria-labelledby="viz-object-name">
                {NAMES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="round-control pressable"
                    aria-pressed={objectName === item.id}
                    onClick={() => onObjectName(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="viz-field">
              <span id="viz-body-name">Body Name</span>
              <div className="viz-choices" role="group" aria-labelledby="viz-body-name">
                {NAMES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="round-control pressable"
                    aria-pressed={bodyName === item.id}
                    onClick={() => onBodyName(item.id)}
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
