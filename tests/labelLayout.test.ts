import { describe, expect, it } from "vitest";
import { labelPrimary } from "../src/core/ephemeris/bodies";
import { dropCloseMoons, layoutLabelAnchors, type LabelAnchor, type PlacedLabel } from "../src/view/labelLayout";

function covers(a: LabelAnchor, b: LabelAnchor): boolean {
  const aLeft = a.x - a.w / 2;
  const bLeft = b.x - b.w / 2;
  const aTop = a.y - 8 - a.h;
  const bTop = b.y - 8 - b.h;
  const x = Math.min(aLeft + a.w, bLeft + b.w) - Math.max(aLeft, bLeft);
  const y = Math.min(aTop + a.h, bTop + b.h) - Math.max(aTop, bTop);
  return x > 0 && y > 0;
}

describe("label layout", () => {
  it("keeps a fixed name and moves the one that covers it", () => {
    const earth: LabelAnchor = { x: 200, y: 180, w: 48, h: 10, fixed: true };
    const moon: LabelAnchor = { x: 204, y: 176, w: 44, h: 10, fixed: false };
    const [placedEarth, placedMoon] = layoutLabelAnchors([earth, moon]);
    expect(placedEarth).toEqual(earth);
    expect(covers(placedEarth, placedMoon)).toBe(false);
  });

  it("separates two neighbor names that share a screen point", () => {
    const earth: LabelAnchor = { x: 100, y: 100, w: 48, h: 10, fixed: false };
    const moon: LabelAnchor = { x: 100, y: 100, w: 44, h: 10, fixed: false };
    const placed = layoutLabelAnchors([earth, moon]);
    expect(covers(placed[0], placed[1])).toBe(false);
    expect(placed[0].y).toBe(100);
  });
});

function named(bodyId: number, x: number, y: number, radiusPx = 0): PlacedLabel {
  return { x, y, w: 48, h: 10, fixed: false, bodyId, sx: x, sy: y, radiusPx };
}

describe("moon labels", () => {
  it("keeps the planet and drops a moon whose name sits on it", () => {
    const earth = named(399, 200, 180);
    const moon = named(301, 204, 176);
    const io = named(501, 800, 180);
    const jupiter = named(599, 808, 176);
    const kept = dropCloseMoons([earth, moon, jupiter, io], labelPrimary);
    expect(kept.map((item) => item.bodyId)).toEqual([399, 599]);
  });

  it("shows a moon once its label is apart from the planet", () => {
    const earth = named(399, 100, 100);
    const moon = named(301, 320, 100);
    const kept = dropCloseMoons([earth, moon], labelPrimary);
    expect(kept.map((item) => item.bodyId)).toEqual([399, 301]);
  });

  it("hides a moon that still lies on the planet disk", () => {
    const earth = named(399, 200, 40, 80);
    const moon = named(301, 200, 140, 4);
    const kept = dropCloseMoons([earth, moon], labelPrimary);
    expect(kept.map((item) => item.bodyId)).toEqual([399]);
  });

  it("uses the same planet for every view, including a moon at the origin", () => {
    const moon = { ...named(301, 100, 100), fixed: true };
    const earth = named(399, 104, 96);
    const kept = dropCloseMoons([moon, earth], labelPrimary);
    expect(kept.map((item) => item.bodyId)).toEqual([399]);
  });
});
