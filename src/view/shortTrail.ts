/** Share of an arc kept behind the craft. The older end of that piece fades out. */
const SHORT_TRAIL_FRACTION = 0.08;
/** Portion of the short trail, measured from the older end, that fades in. */
const SHORT_TRAIL_FADE = 0.45;

/** Fade along the short trail. 0 at the older end, solid once `SHORT_TRAIL_FADE` of the window is passed. */
function shortTrailFade(oldest: number, newest: number, time: number): number {
  const span = newest - oldest;
  if (!(span > 0)) return 1;
  const u = (time - oldest) / span;
  if (u <= 0) return 0;
  if (u >= SHORT_TRAIL_FADE) return 1;
  const x = u / SHORT_TRAIL_FADE;
  return x * x * (3 - 2 * x);
}

function shortTrailOldest(start: number, stop: number, time: number): number {
  const span = stop - start;
  const window = span > 0 ? span * SHORT_TRAIL_FRACTION : 0;
  return Math.max(start, time - window);
}

/** Greatest vertex index whose time is at or before `t`, or -1 when the arc is still ahead. */
export function lastAtOrBefore(times: Float32Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Writes the short trail into the line buffers.
 * An arc whose last sample is already behind the clock draws nothing, so a finished segment does not leave its tail on screen.
 * Returns the number of segments drawn.
 */
export function writeShortTrail(
  positions: Float32Array,
  times: Float32Array,
  time: number,
  posData: Float32Array,
  fadeStart: Float32Array,
  fadeEnd: Float32Array,
): number {
  const tip = lastAtOrBefore(times, time);
  if (tip < 0 || times.length < 2) return 0;
  if (time > times[times.length - 1]) return 0;
  const newest = Math.min(time, times[times.length - 1]);
  const oldest = shortTrailOldest(times[0], times[times.length - 1], newest);
  if (!(newest > oldest)) return 0;
  const tail = lastAtOrBefore(times, oldest);
  if (tail < 0) return 0;
  const capacity = Math.min(Math.floor(posData.length / 6), fadeStart.length, fadeEnd.length);
  let count = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let pf = 0;
  let has = false;
  const emit = (x: number, y: number, z: number, fade: number) => {
    if (!has) {
      px = x;
      py = y;
      pz = z;
      pf = fade;
      has = true;
      return;
    }
    if (count >= capacity) return;
    const o = count * 6;
    posData[o] = px;
    posData[o + 1] = py;
    posData[o + 2] = pz;
    posData[o + 3] = x;
    posData[o + 4] = y;
    posData[o + 5] = z;
    fadeStart[count] = pf;
    fadeEnd[count] = fade;
    count += 1;
    px = x;
    py = y;
    pz = z;
    pf = fade;
  };
  const vertex = (index: number, at: number) => {
    const i = index * 3;
    emit(positions[i], positions[i + 1], positions[i + 2], shortTrailFade(oldest, newest, at));
  };
  const lerp = (index: number, u: number, at: number) => {
    const i = index * 3;
    const j = i + 3;
    emit(
      positions[i] + (positions[j] - positions[i]) * u,
      positions[i + 1] + (positions[j + 1] - positions[i + 1]) * u,
      positions[i + 2] + (positions[j + 2] - positions[i + 2]) * u,
      shortTrailFade(oldest, newest, at),
    );
  };
  if (tail < tip) {
    const span = times[tail + 1] - times[tail];
    const u = span > 0 ? (oldest - times[tail]) / span : 0;
    if (u > 0) lerp(tail, Math.min(u, 1), oldest);
    else vertex(tail, times[tail]);
    for (let i = tail + 1; i <= tip; i += 1) vertex(i, times[i]);
  } else if (tip < times.length - 1) {
    const span = times[tip + 1] - times[tip];
    const u = span > 0 ? (oldest - times[tip]) / span : 0;
    lerp(tip, Math.max(0, Math.min(u, 1)), oldest);
  }
  if (tip < times.length - 1) {
    const span = times[tip + 1] - times[tip];
    const u = span > 0 ? (newest - times[tip]) / span : 1;
    lerp(tip, Math.max(0, Math.min(u, 1)), newest);
  } else if (tail === tip) {
    vertex(tip, times[tip]);
  }
  return count;
}
