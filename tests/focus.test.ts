import { describe, expect, it } from "vitest";
import { defaultFocus, focusFromLabel, focusKey } from "../src/view/camera";
import { chooseFocus } from "../src/view/focus";
import type { ScreenPick } from "../src/view/focus";

function pick(partial: Partial<ScreenPick> & Pick<ScreenPick, "focus" | "x" | "y">): ScreenPick {
  return {
    distance: 10,
    hitPx: 16,
    inFront: true,
    ...partial,
  };
}

describe("camera focus", () => {
  it("defaults to the spacecraft when a file is open, and the center otherwise", () => {
    expect(defaultFocus(true)).toEqual({ kind: "craft" });
    expect(defaultFocus(false)).toEqual({ kind: "center" });
    expect(focusKey({ kind: "body", id: 499 })).toBe("body:499");
  });

  it("reads a label's focus dataset", () => {
    expect(focusFromLabel("craft", null)).toEqual({ kind: "craft" });
    expect(focusFromLabel("center", null)).toEqual({ kind: "center" });
    expect(focusFromLabel("body", "399")).toEqual({ kind: "body", id: 399 });
    expect(focusFromLabel("body", "nope")).toBeNull();
    expect(focusFromLabel(null, null)).toBeNull();
  });

  it("picks the closest body whose disk contains the click", () => {
    const earth = pick({ focus: { kind: "body", id: 399 }, x: 100, y: 100, distance: 8000, hitPx: 40 });
    const moon = pick({ focus: { kind: "body", id: 301 }, x: 110, y: 108, distance: 400, hitPx: 12 });
    const craft = pick({ focus: { kind: "craft" }, x: 400, y: 400, distance: 20, hitPx: 18 });
    expect(chooseFocus(108, 104, [earth, moon, craft])).toEqual({ kind: "body", id: 301 });
    expect(chooseFocus(400, 400, [earth, moon, craft])).toEqual({ kind: "craft" });
    expect(chooseFocus(20, 20, [earth, moon, craft])).toBeNull();
  });

  it("ignores a body behind the camera", () => {
    const hidden = pick({ focus: { kind: "center" }, x: 50, y: 50, inFront: false, hitPx: 80 });
    expect(chooseFocus(50, 50, [hidden])).toBeNull();
  });
});
