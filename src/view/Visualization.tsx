import { useRef, useState } from "react";
import type { BodyLabelKind } from "../core/ephemeris/bodies";
import type { TrajectoryLine } from "./OrbitView";
import { ORBIT_PILLS } from "./orbitTrack";
import type { OrbitLineId, OrbitToggles } from "./orbitTrack";
import { HideButton } from "./HideButton";
import { useBoxMotion } from "./useBoxMotion";

export type LabelKind = "object" | BodyLabelKind;
export type LabelToggles = Record<LabelKind, boolean>;
export type RenderStyle = "minimal" | "realistic";

const LINES: { id: TrajectoryLine; label: string }[] = [
  { id: "all", label: "Full Path" },
  { id: "trail", label: "Trail" },
  { id: "short", label: "Short Trail" },
  { id: "hidden", label: "Hidden" },
];

export const DEFAULT_LABELS: LabelToggles = {
  object: true,
  sun: true,
  planet: true,
  moon: true,
  barycenter: true,
  lagrange: true,
};

const LABELS: { id: LabelKind; label: string }[] = [
  { id: "object", label: "Object" },
  { id: "sun", label: "Sun" },
  { id: "planet", label: "Planet" },
  { id: "moon", label: "Moon" },
  { id: "barycenter", label: "Barycenter" },
  { id: "lagrange", label: "Lagrange" },
];

const STYLES: { id: RenderStyle; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "realistic", label: "Realistic" },
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
  labels,
  orbits,
  showTrajectory,
  renderStyle,
  clouds,
  stars,
  onToggle,
  onLine,
  onColor,
  onLabel,
  onOrbit,
  onRenderStyle,
  onClouds,
  onStars,
}: {
  open: boolean;
  line: TrajectoryLine;
  color: string;
  labels: LabelToggles;
  orbits: OrbitToggles;
  /** Object path and color. Off in the solar view, which has no spacecraft. */
  showTrajectory: boolean;
  renderStyle: RenderStyle;
  clouds: boolean;
  stars: boolean;
  onToggle: () => void;
  onLine: (line: TrajectoryLine) => void;
  onColor: (color: string) => void;
  onLabel: (kind: LabelKind) => void;
  onOrbit: (id: OrbitLineId) => void;
  onRenderStyle: (style: RenderStyle) => void;
  onClouds: () => void;
  onStars: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [arrived, setArrived] = useState(false);
  const [text, setText] = useState(color);
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
              <div className="viz-choices" role="group" aria-label="Realistic options">
                <button
                  type="button"
                  className="round-control pressable"
                  aria-pressed={clouds}
                  onClick={onClouds}
                >
                  Earth Cloud
                </button>
                <button
                  type="button"
                  className="round-control pressable"
                  aria-pressed={stars}
                  onClick={onStars}
                >
                  Background Stars
                </button>
              </div>
            )}
          </section>
          <section className="viz-group">
            {showTrajectory && (
              <>
                <h3>Trajectory</h3>
                <div className="viz-field">
                  <span id="viz-line">Object</span>
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
                <div className="viz-field">
                  <span>Color</span>
                  <span className="viz-color">
                    <span className="viz-swatch" style={{ background: color }} aria-hidden="true" />
                    <input
                      className="viz-hex nums"
                      aria-label="Trajectory color"
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
                        setText(parseHex(event.currentTarget.value) ?? color);
                      }}
                    />
                  </span>
                </div>
              </>
            )}
            <div className="viz-field">
              <span id="viz-orbits">Orbit Lines</span>
              <div className="viz-choices" role="group" aria-labelledby="viz-orbits">
                {ORBIT_PILLS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="round-control pressable"
                    aria-pressed={orbits[item.id]}
                    onClick={() => onOrbit(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="viz-group">
            <h3>Label</h3>
            <div className="viz-choices" role="group" aria-label="Label">
              {LABELS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="round-control pressable"
                  aria-pressed={labels[item.id]}
                  onClick={() => onLabel(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
