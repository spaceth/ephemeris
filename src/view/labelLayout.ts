/**
 * Screen labels hang from an anchor: centered on x, bottom 8px above y.
 * A fixed label keeps that anchor. A later label that would cover it,
 * or another label already placed, is shifted until the boxes are apart.
 * A moon whose label sits on its planet is left out. The planet name stays.
 */

import { labelPrimary } from "../core/ephemeris/bodies";

const HANG = 8;
const GAP = 4;
/** Labels this close, in pixels, still count as one name. */
const APART_PX = 16;

export type LabelAnchor = {
  x: number;
  y: number;
  w: number;
  h: number;
  fixed: boolean;
};

export type PlacedLabel = LabelAnchor & {
  bodyId: number | null;
  /** Body center on screen, before the name is lifted to the limb. */
  sx: number;
  sy: number;
  radiusPx: number;
};

type Box = { left: number; right: number; top: number; bottom: number };

function boxOf(item: LabelAnchor): Box {
  return {
    left: item.x - item.w / 2,
    right: item.x + item.w / 2,
    top: item.y - HANG - item.h,
    bottom: item.y - HANG,
  };
}

function overlap(a: LabelAnchor, b: LabelAnchor): { x: number; y: number } | null {
  const left = boxOf(a);
  const right = boxOf(b);
  const x = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const y = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  if (x <= 0 || y <= 0) return null;
  return { x, y };
}

function gap(a: LabelAnchor, b: LabelAnchor): { x: number; y: number } {
  const left = boxOf(a);
  const right = boxOf(b);
  return {
    x: Math.max(left.left - right.right, right.left - left.right, 0),
    y: Math.max(left.top - right.bottom, right.top - left.bottom, 0),
  };
}

/** True when two names would read as one stack. */
export function labelsAreClose(a: LabelAnchor, b: LabelAnchor): boolean {
  const space = gap(a, b);
  return space.x <= APART_PX && space.y <= APART_PX && Math.hypot(space.x, space.y) <= APART_PX;
}

/** The moon name stays when its body and its label are both clear of the planet. */
export function moonLabelKept(moon: PlacedLabel, planet: PlacedLabel): boolean {
  if (labelsAreClose(moon, planet)) return false;
  const dist = Math.hypot(moon.sx - planet.sx, moon.sy - planet.sy);
  return dist > planet.radiusPx + moon.radiusPx + APART_PX;
}

/** Drops a moon whose name sits on its planet. Other labels stay, in order. */
export function dropCloseMoons<T extends PlacedLabel>(
  items: readonly T[],
  primaryOf: (bodyId: number) => number | null,
): T[] {
  const byId = new Map<number, T>();
  for (const item of items) {
    if (item.bodyId != null && !byId.has(item.bodyId)) byId.set(item.bodyId, item);
  }
  return items.filter((item) => {
    if (item.bodyId == null) return true;
    const primary = primaryOf(item.bodyId);
    if (primary == null) return true;
    const planet = byId.get(primary);
    if (!planet || planet === item) return true;
    return moonLabelKept(item, planet);
  });
}

/** Returns anchors in the same order they were given. */
export function layoutLabelAnchors(items: readonly LabelAnchor[]): LabelAnchor[] {
  const out = items.map((item) => ({ ...item }));
  const order = out
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Number(b.item.fixed) - Number(a.item.fixed) || a.item.y - b.item.y || a.index - b.index);
  const placed: LabelAnchor[] = [];
  for (const { item } of order) {
    if (!item.fixed) {
      for (let pass = 0; pass < 24; pass += 1) {
        let blocked = false;
        for (const other of placed) {
          const hit = overlap(item, other);
          if (!hit) continue;
          blocked = true;
          if (hit.y <= hit.x) {
            const dir = item.y <= other.y ? -1 : 1;
            item.y += dir * (hit.y + GAP);
          } else {
            const dir = item.x <= other.x ? -1 : 1;
            item.x += dir * (hit.x + GAP);
          }
        }
        if (!blocked) break;
      }
    }
    placed.push(item);
  }
  return out;
}

type Queued = PlacedLabel & { el: HTMLElement };

const queued: Queued[] = [];

export function queueSceneLabel(
  el: HTMLElement,
  x: number,
  y: number,
  fixed: boolean,
  bodyId: number | null = null,
  sx = x,
  sy = y,
  radiusPx = 0,
): void {
  queued.push({
    el,
    x,
    y,
    w: Math.max(el.offsetWidth, 1),
    h: Math.max(el.offsetHeight, 1),
    fixed,
    bodyId,
    sx,
    sy,
    radiusPx,
  });
}

/** Apply one frame of label anchors. Call after every label has been queued. */
export function settleSceneLabels(): void {
  if (queued.length === 0) return;
  const kept = dropCloseMoons(queued, labelPrimary);
  const laid = layoutLabelAnchors(kept);
  const keep = new Set<Queued>(kept);
  let placed = 0;
  for (const item of queued) {
    if (!keep.has(item)) {
      item.el.style.visibility = "hidden";
      continue;
    }
    const pos = laid[placed];
    placed += 1;
    const x = Math.round(pos.x);
    const y = Math.round(pos.y);
    item.el.style.visibility = "visible";
    item.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 8px))`;
  }
  queued.length = 0;
}
