import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindCraft, craftSession, displayedState } from "../src/core/ephemeris/craft";
import { writeSpk } from "../src/core/ephemeris/dafWrite";
import { loadOrder, stateRelative } from "../src/core/ephemeris/resolve";

const bytes = readFileSync(new URL("./fixtures/discrete.bsp", import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

describe("spacecraft SPK", () => {
  it("evaluates the opened kernel instead of OEM samples", () => {
    const session = craftSession(buffer);
    bindCraft(session.file, buffer);
    const segment = session.file.segments.find((item) => item.objectId === "-512");
    expect(segment?.calculationSupported).toBe(true);
    expect(segment?.samples).toHaveLength(0);
    const t = (segment?.evalStart ?? 0) + 45;
    const shown = displayedState(session.file, t, segment?.index);
    const kernels = loadOrder([buffer]);
    const direct = stateRelative(kernels, -512, 399, 45, "EME2000");
    expect(shown.ok && direct.ok).toBe(true);
    if (!shown.ok || !direct.ok) return;
    expect(shown.positionM[0]).toBeCloseTo(direct.state.positionM[0], 6);
    expect(shown.eme2000PositionM?.[1]).toBeCloseTo(direct.state.positionM[1], 6);
    expect(session.arcs.some((arc) => arc.segmentIndex === segment?.index && arc.positions.length >= 6)).toBe(true);
  });

  it("keeps an unsupported type inspectable and undrawn", () => {
    const blocked = writeSpk([
      {
        target: -500,
        center: 399,
        frame: 1,
        type: 18,
        startEt: 0,
        stopEt: 100,
      },
    ]);
    const session = craftSession(blocked);
    expect(session.file.segments).toHaveLength(1);
    expect(session.file.segments[0].calculationSupported).toBe(false);
    expect(session.file.segments[0].unsupportedReason).toMatch(/type 18/);
    expect(session.arcs).toHaveLength(0);
    bindCraft(session.file, blocked);
    const shown = displayedState(session.file, 0, 0);
    expect(shown.ok).toBe(false);
    if (!shown.ok) expect(shown.message).toMatch(/type 18/);
  });

  it("gives a shared boundary to the later segment", () => {
    const session = craftSession(buffer);
    const early = session.file.segments.find((item) => item.objectId === "-510" && (item.evalStop ?? 0) < 500);
    const late = session.file.segments.find((item) => item.objectId === "-510" && (item.evalStart ?? 0) >= 300);
    expect(early && late).toBeTruthy();
    expect((early?.evalStop ?? 0) < (late?.evalStart ?? 0)).toBe(true);
  });
});
