/**
 * Playback rates for the viewing clock. The fastest rate crosses the whole
 * span in about a minute. The steps below it are an exponential ladder, and
 * every step is rounded up onto 1, 2, or 5 so the button reads as a clean
 * multiplier instead of a leftover of the span length.
 */

const SPEED_COUNT = 5;
const FULL_SPAN_SECONDS = 60;

const PACE_UNITS = [
  { limit: 90, size: 1, unit: "s" },
  { limit: 90 * 60, size: 60, unit: "min" },
  { limit: 36 * 3600, size: 3600, unit: "hr" },
  { limit: 500 * 86400, size: 86400, unit: "d" },
  { limit: Infinity, size: 86400 * 365.25, unit: "yr" },
] as const;

export function playbackSpeeds(spanSeconds: number): number[] {
  if (!(spanSeconds > 0)) return [1];
  const fastest = roundUpNice(Math.max(1, spanSeconds / FULL_SPAN_SECONDS));
  const ladder = niceLadder(fastest);
  if (ladder.length <= SPEED_COUNT) return ladder;
  const last = ladder.length - 1;
  const picked: number[] = [];
  for (let step = 0; step < SPEED_COUNT; step += 1) {
    const index = step === SPEED_COUNT - 1 ? last : Math.ceil((step * last) / (SPEED_COUNT - 1));
    const speed = ladder[index];
    if (picked[picked.length - 1] !== speed) picked.push(speed);
  }
  if (picked[picked.length - 1] !== fastest) picked.push(fastest);
  return picked;
}

/** `20k×` for 20000. The suffix stays a single letter so the pill stays short. */
export function speedLabel(speed: number): string {
  const abs = Math.abs(speed);
  if (abs >= 1e9) return `${scaled(abs / 1e9)}B×`;
  if (abs >= 1e6) return `${scaled(abs / 1e6)}M×`;
  if (abs >= 1e3) return `${scaled(abs / 1e3)}k×`;
  return `${speed}×`;
}

/** How long the full span takes at `speed`, rounded to a whole unit. */
export function spanPace(spanSeconds: number, speed: number): string {
  const seconds = spanSeconds / Math.max(speed, 1);
  const place = PACE_UNITS.find((unit) => seconds < unit.limit) ?? PACE_UNITS[PACE_UNITS.length - 1];
  const amount = Math.max(1, Math.round(seconds / place.size));
  return `${amount} ${place.unit}`;
}

function niceLadder(fastest: number): number[] {
  const ladder = [1];
  let value = 1;
  while (value < fastest) {
    value = nextNice(value);
    if (value >= fastest) break;
    ladder.push(value);
  }
  if (ladder[ladder.length - 1] !== fastest) ladder.push(fastest);
  return ladder;
}

function roundUpNice(value: number): number {
  if (value <= 1) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const mantissa = value / base;
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return nice * base;
}

function nextNice(value: number): number {
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const mantissa = Math.round(value / base);
  if (mantissa < 2) return 2 * base;
  if (mantissa < 5) return 5 * base;
  return 10 * base;
}

function scaled(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
