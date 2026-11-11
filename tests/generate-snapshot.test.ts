import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cutSpk } from "../src/core/ephemeris/cut";
import { EARTH, EMB, MOON, SUN } from "../src/core/ephemeris/state";
import { J2000_JD } from "../src/core/ephemeris/scales";
import { DAYSEC, cal2jd } from "../src/core/time";

const SOURCE = "data/kernels/de440.bsp";
const GM = "data/kernels/gm_de440.tpc";
const OUT_SPK = "public/ephemeris/de440-earth-moon-sun.bsp";
const OUT_MANIFEST = "public/ephemeris/de440-earth-moon-sun.json";

function etAtUtcCalendar(year: number, month: number, day: number): number {
  const { djm0, djm } = cal2jd(year, month, day);
  return (djm0 + djm - J2000_JD) * DAYSEC;
}

function gm(text: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*\\(\\s*([0-9.DEde+-]+)\\s*\\)`).exec(text);
  if (!match) throw new Error(`Missing ${name}`);
  return Number(match[1].replace(/D/g, "E"));
}

describe.skipIf(process.env.CUT_DE440 !== "1")("DE440 Earth-Moon-Sun cut", () => {
  it("writes native segments and a manifest", () => {
    const sourceBytes = readFileSync(SOURCE);
    const source = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    const startEt = etAtUtcCalendar(1950, 1, 1);
    const stopEt = etAtUtcCalendar(2050, 1, 1);
    const cut = cutSpk(source, [EMB, SUN, MOON, EARTH], startEt, stopEt);
    const targets = cut.segments.map((segment) => segment.target);
    expect(targets).toEqual([EMB, SUN, MOON, EARTH]);
    for (const segment of cut.segments) {
      expect(segment.type).toBe(2);
      expect(segment.frame).toBe(1);
      expect(segment.count).toBeGreaterThan(0);
    }
    const moon = cut.segments.find((segment) => segment.target === MOON);
    const earth = cut.segments.find((segment) => segment.target === EARTH);
    expect(moon?.center).toBe(EMB);
    expect(earth?.center).toBe(EMB);
    expect(cut.segments.find((segment) => segment.target === EMB)?.center).toBe(0);
    expect(cut.segments.find((segment) => segment.target === SUN)?.center).toBe(0);
    const gmText = readFileSync(GM, "utf8");
    const earthGm = gm(gmText, "BODY399_GM");
    const moonGm = gm(gmText, "BODY301_GM");
    const manifest = {
      version: 1,
      product: "DE440 Earth, Moon, Earth-Moon barycenter, and Sun",
      source: {
        url: "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp",
        sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      },
      constants: {
        url: "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc",
        sha256: createHash("sha256").update(gmText).digest("hex"),
        body399GmKm3s2: earthGm,
        body301GmKm3s2: moonGm,
        emrat: earthGm / moonGm,
        note: "EMRAT is BODY399_GM / BODY301_GM from gm_de440.tpc. It is not read from an SPK segment. The native Earth segment is the served state.",
      },
      frame: "NAIF frame 1 on this DE440 kernel is ICRF, not dynamical EME2000.",
      units: "kilometers and kilometers per second in the SPK. The application API converts to meters once.",
      time: "TDB seconds past J2000. The cut window is the Julian dates of 1950-01-01 and 2050-01-01 at 0h, expanded to native interval boundaries.",
      requestedWindowEt: [startEt, stopEt],
      segments: cut.segments,
      output: {
        file: "de440-earth-moon-sun.bsp",
        bytes: cut.buffer.byteLength,
        sha256: createHash("sha256").update(Buffer.from(cut.buffer)).digest("hex"),
      },
    };
    mkdirSync("public/ephemeris", { recursive: true });
    writeFileSync(OUT_SPK, Buffer.from(cut.buffer));
    writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(cut.buffer.byteLength).toBeGreaterThan(1_000_000);
  });
});
