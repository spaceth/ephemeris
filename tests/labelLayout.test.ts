import { describe, expect, it } from "vitest";
import { layoutLabelAnchors, type LabelAnchor } from "../src/view/labelLayout";

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
