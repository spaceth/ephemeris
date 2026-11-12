/**
 * Sun-flare parameters. The effect reads this object every frame.
 * Lens position, time, resolution, and the dirt texture stay on the scene.
 *
 * The panel is debug-only. Set FLARE_DEBUG to true and rebuild to show it.
 */

/** User-facing builds leave this false. The panel appears only after this is edited. */
export const FLARE_DEBUG = false;

export const FLARE_TUNE_KEY = "ephemeris.flare-tune";

export type FlareTune = {
  enabled: boolean;
  /** Manual flareGain. Used while gainFollowsZoom is off. */
  flareGain: number;
  /** Distant-Sun flareGain. Used while gainFollowsZoom is on. */
  flareFar: number;
  /** Nearby-Sun flareGain. Used while gainFollowsZoom is on. */
  flareNear: number;
  /** Disk size on screen where the gain starts to rise. */
  zoomStart: number;
  /** Disk size on screen where the gain reaches flareNear. */
  zoomEnd: number;
  gainFollowsZoom: boolean;
  flareSpread: number;
  optical: number;
  glareSize: number;
  glareBoost: number;
  colorR: number;
  colorG: number;
  colorB: number;
  anamorphic: boolean;
  animated: boolean;
  flareSize: number;
  flareShape: number;
  flareSpeed: number;
  starPoints: number;
  secondaryGhosts: boolean;
  ghostScale: number;
  aditionalStreaks: boolean;
  haloScale: number;
  starBurst: boolean;
  /** Manual cover. 0 shows the flare, 1 hides it. */
  opacity: number;
  /** Cover used when a body blocks the Sun. 0 shows the flare, 1 hides it. */
  flareCover: number;
  /** Seconds the cover takes to catch its target. */
  coverDamp: number;
  coverFollowsOcclusion: boolean;
};

export const FLARE_DEFAULTS: FlareTune = {
  enabled: true,
  flareGain: 1.05,
  flareFar: 2.02,
  flareNear: 8,
  zoomStart: 0.12,
  zoomEnd: 0.04,
  gainFollowsZoom: false,
  flareSpread: 0.0001,
  optical: 0.063,
  glareSize: 0.64,
  glareBoost: 0.24,
  colorR: 0.67,
  colorG: 1.02,
  colorB: 1.38,
  anamorphic: true,
  animated: false,
  flareSize: 0.001,
  flareShape: 0.08,
  flareSpeed: 0.06,
  starPoints: 3,
  secondaryGhosts: true,
  ghostScale: 0.02,
  aditionalStreaks: false,
  haloScale: 0,
  starBurst: false,
  opacity: 0,
  flareCover: 0,
  coverDamp: 0.06,
  coverFollowsOcclusion: true,
};

export function flareDefaults(): FlareTune {
  return { ...FLARE_DEFAULTS };
}

const FLARE_KEYS = Object.keys(FLARE_DEFAULTS) as (keyof FlareTune)[];

export function loadFlareTune(): FlareTune {
  const tune = flareDefaults();
  if (!FLARE_DEBUG) return tune;
  try {
    const raw = localStorage.getItem(FLARE_TUNE_KEY);
    if (!raw) return tune;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return tune;
    const record = parsed as Record<string, unknown>;
    for (const key of FLARE_KEYS) {
      const next = record[key];
      const sameKind = typeof next === typeof tune[key];
      const finite = typeof next !== "number" || Number.isFinite(next);
      if (sameKind && finite) tune[key] = next as never;
    }
  } catch {
    return tune;
  }
  return tune;
}

export function saveFlareTune(tune: FlareTune): void {
  try {
    localStorage.setItem(FLARE_TUNE_KEY, JSON.stringify(tune));
  } catch {
    /* The panel still drives the live effect when storage is unavailable. */
  }
}
