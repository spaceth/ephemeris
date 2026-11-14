/**
 * Screen labels hang from an anchor: centered on x, bottom 8px above y.
 * A fixed label keeps that anchor. A later label that would cover it,
 * or another label already placed, is shifted until the boxes are apart.
 */

const HANG = 8;
const GAP = 4;

export type LabelAnchor = {
  x: number;
  y: number;
  w: number;
  h: number;
  fixed: boolean;
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

type Queued = LabelAnchor & { el: HTMLElement };

const queued: Queued[] = [];

export function queueSceneLabel(el: HTMLElement, x: number, y: number, fixed: boolean): void {
  queued.push({
    el,
    x,
    y,
    w: Math.max(el.offsetWidth, 1),
    h: Math.max(el.offsetHeight, 1),
    fixed,
  });
}

/** Apply one frame of label anchors. Call after every label has been queued. */
export function settleSceneLabels(): void {
  if (queued.length === 0) return;
  const laid = layoutLabelAnchors(queued);
  for (let index = 0; index < queued.length; index += 1) {
    const el = queued[index].el;
    const pos = laid[index];
    const x = Math.round(pos.x);
    const y = Math.round(pos.y);
    el.style.visibility = "visible";
    el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 8px))`;
  }
  queued.length = 0;
}
