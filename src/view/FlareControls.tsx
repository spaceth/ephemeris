/**
 * Debug controls for every sun-flare parameter. Shown only when FLARE_DEBUG
 * is true. Hide closes the box; the values stay for that debug session.
 */
import { useRef, useState } from "react";
import type { RefObject } from "react";
import { HideButton } from "./HideButton";
import { flareDefaults, saveFlareTune } from "./flareTune";
import type { FlareTune } from "./flareTune";

type NumKey = {
  [K in keyof FlareTune]: FlareTune[K] extends number ? K : never;
}[keyof FlareTune];

type BoolKey = {
  [K in keyof FlareTune]: FlareTune[K] extends boolean ? K : never;
}[keyof FlareTune];

type NumField = {
  kind: "num";
  key: NumKey;
  label: string;
  title: string;
  min: number;
  max: number;
  step: number;
  idle?: (tune: FlareTune) => boolean;
};

type BoolField = {
  kind: "bool";
  key: BoolKey;
  label: string;
  title: string;
};

type Field = NumField | BoolField;

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: "Glow",
    fields: [
      { kind: "bool", key: "enabled", label: "enabled", title: "Draw the flare" },
      { kind: "bool", key: "gainFollowsZoom", label: "gainFollowsZoom", title: "flareGain rises as the Sun fills the view" },
      { kind: "num", key: "flareGain", label: "flareGain", title: "Glow strength while gainFollowsZoom is off", min: 0, max: 8, step: 0.01, idle: (tune) => tune.gainFollowsZoom },
      { kind: "num", key: "flareFar", label: "flareFar", title: "Glow when the Sun is small", min: 0, max: 8, step: 0.01, idle: (tune) => !tune.gainFollowsZoom },
      { kind: "num", key: "flareNear", label: "flareNear", title: "Glow when the Sun fills the view", min: 0, max: 8, step: 0.01, idle: (tune) => !tune.gainFollowsZoom },
      { kind: "num", key: "zoomStart", label: "zoomStart", title: "On-screen size where the glow starts to rise", min: 0, max: 3, step: 0.01, idle: (tune) => !tune.gainFollowsZoom },
      { kind: "num", key: "zoomEnd", label: "zoomEnd", title: "On-screen size where the glow reaches flareNear", min: 0, max: 3, step: 0.01, idle: (tune) => !tune.gainFollowsZoom },
      { kind: "num", key: "flareSpread", label: "flareSpread", title: "Width of the glow. Smaller is tighter", min: 0.0001, max: 0.05, step: 0.0001 },
    ],
  },
  {
    title: "Glare",
    fields: [
      { kind: "num", key: "glareSize", label: "glareSize", title: "Size of the glare on the disk", min: 0, max: 4, step: 0.01 },
      { kind: "num", key: "glareBoost", label: "glareBoost", title: "Scales the glare, ghosts inside it, and the streak", min: 0, max: 4, step: 0.01 },
      { kind: "num", key: "optical", label: "optical", title: "Strength of the glare and streak term", min: 0, max: 2, step: 0.001 },
      { kind: "num", key: "colorR", label: "colorGain R", title: "Red tint of the glare and streak", min: 0, max: 4, step: 0.01 },
      { kind: "num", key: "colorG", label: "colorGain G", title: "Green tint of the glare and streak", min: 0, max: 4, step: 0.01 },
      { kind: "num", key: "colorB", label: "colorGain B", title: "Blue tint of the glare and streak", min: 0, max: 4, step: 0.01 },
    ],
  },
  {
    title: "Streak",
    fields: [
      { kind: "bool", key: "anamorphic", label: "anamorphic", title: "Horizontal lens streak" },
      { kind: "bool", key: "animated", label: "animated", title: "Rotate the glare over time" },
      { kind: "num", key: "flareSize", label: "flareSize", title: "Strength of the streak", min: 0, max: 2, step: 0.001 },
      { kind: "num", key: "flareShape", label: "flareShape", title: "How tightly the streak is shaped", min: 0, max: 2, step: 0.001 },
      { kind: "num", key: "flareSpeed", label: "flareSpeed", title: "Color shift along the streak. 0 keeps it white", min: 0, max: 2, step: 0.01 },
      { kind: "num", key: "starPoints", label: "starPoints", title: "Blade count when anamorphic is off", min: 1, max: 16, step: 1 },
    ],
  },
  {
    title: "Ghosts",
    fields: [
      { kind: "bool", key: "secondaryGhosts", label: "secondaryGhosts", title: "Hexagonal ghosts across the frame" },
      { kind: "num", key: "ghostScale", label: "ghostScale", title: "Size of the ghosts", min: 0, max: 5, step: 0.01 },
      { kind: "bool", key: "aditionalStreaks", label: "aditionalStreaks", title: "Extra colored streaks" },
      { kind: "num", key: "haloScale", label: "haloScale", title: "Scale of the halo used by the starburst", min: 0, max: 2, step: 0.01 },
      { kind: "bool", key: "starBurst", label: "starBurst", title: "Starburst and lens dirt" },
    ],
  },
  {
    title: "Cover",
    fields: [
      { kind: "bool", key: "coverFollowsOcclusion", label: "coverFollowsOcclusion", title: "Hide the flare when a body is in front of the Sun" },
      { kind: "num", key: "opacity", label: "opacity", title: "Cover while the Sun is in view. 0 shows it, 1 hides it", min: 0, max: 1, step: 0.01, idle: (tune) => tune.coverFollowsOcclusion },
      { kind: "num", key: "flareCover", label: "flareCover", title: "Cover where nothing blocks the Sun. 0 shows it, 1 hides it", min: 0, max: 1, step: 0.01, idle: (tune) => !tune.coverFollowsOcclusion },
      { kind: "num", key: "coverDamp", label: "coverDamp", title: "Seconds the cover takes to catch up", min: 0.01, max: 0.5, step: 0.01, idle: (tune) => !tune.coverFollowsOcclusion },
    ],
  },
];

export function FlareControls({
  tune,
  realistic,
}: {
  tune: RefObject<FlareTune>;
  realistic: boolean;
}) {
  const [value, setValue] = useState(() => tune.current);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  function publish(next: FlareTune) {
    tune.current = next;
    setValue(next);
    saveFlareTune(next);
  }

  function copy() {
    const text = JSON.stringify(value, null, 2);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => setCopied(false));
  }

  return (
    <div className={open ? "flare-tune material" : "flare-tune material is-collapsed"}>
      <div className="box-head">
        <h2 className="box-title">Sun flare</h2>
        <HideButton open={open} label="sun flare" onClick={() => setOpen((shown) => !shown)} />
      </div>
      {open && (
        <div className="viz-body">
          <p className="flare-note">{realistic ? "Live on the Sun. Temporary." : "Turn on Realistic to see it. Temporary."}</p>
          <div className="flare-actions">
            <button type="button" className="round-control pressable" onClick={() => publish(flareDefaults())}>Reset</button>
            <button type="button" className="round-control pressable" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          {SECTIONS.map((section) => (
            <section className="viz-group" key={section.title}>
              <h3>{section.title}</h3>
              {section.fields.map((field) => {
                const idle = field.kind === "num" && field.idle ? field.idle(value) : false;
                if (field.kind === "bool") {
                  const on = value[field.key];
                  return (
                    <div className="flare-toggle" key={field.key} title={field.title}>
                      <span>{field.label}</span>
                      <button
                        type="button"
                        className="round-control pressable"
                        aria-pressed={on}
                        onClick={() => publish({ ...value, [field.key]: !on })}
                      >
                        {on ? "On" : "Off"}
                      </button>
                    </div>
                  );
                }
                const current = value[field.key];
                return (
                  <div className={idle ? "flare-field is-idle" : "flare-field"} key={field.key} title={field.title}>
                    <label htmlFor={`flare-${field.key}`}>{field.label}</label>
                    <input
                      className="flare-num"
                      type="number"
                      inputMode="decimal"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={current}
                      aria-label={field.label}
                      onChange={(event) => {
                        const next = event.target.valueAsNumber;
                        if (Number.isFinite(next)) publish({ ...value, [field.key]: next });
                      }}
                    />
                    <input
                      id={`flare-${field.key}`}
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={Math.min(field.max, Math.max(field.min, current))}
                      aria-label={field.label}
                      onChange={(event) => {
                        const next = event.target.valueAsNumber;
                        if (Number.isFinite(next)) publish({ ...value, [field.key]: next });
                      }}
                    />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
