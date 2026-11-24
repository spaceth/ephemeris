import { describe, expect, it } from "vitest";
import { writeShortTrail } from "../src/view/shortTrail";

function line(count: number): { positions: Float32Array; times: Float32Array } {
  const positions = new Float32Array(count * 3);
  const times = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = i * 100;
    times[i] = i * 100;
  }
  return { positions, times };
}

function draw(time: number, count = 5): number {
  const { positions, times } = line(count);
  const segments = count - 1;
  return writeShortTrail(
    positions,
    times,
    time,
    new Float32Array(segments * 6),
    new Float32Array(segments),
    new Float32Array(segments),
  );
}

describe("short trail", () => {
  it("draws the trail while the clock is still on the arc", () => {
    expect(draw(250)).toBeGreaterThan(0);
    expect(draw(400)).toBeGreaterThan(0);
  });

  it("drops the trail once the segment has ended", () => {
    expect(draw(400.001)).toBe(0);
    expect(draw(900)).toBe(0);
  });

  it("draws nothing before the arc starts", () => {
    expect(draw(-1)).toBe(0);
  });
});
