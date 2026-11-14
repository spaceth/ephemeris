import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_TARGETS } from "../src/core/ephemeris/bodies";
import { cutSpk } from "../src/core/ephemeris/cut";
import { EARTH, EMB, MOON, SUN } from "../src/core/ephemeris/state";
import { J2000_JD } from "../src/core/ephemeris/scales";
import { DAYSEC, cal2jd } from "../src/core/time";

const SOURCE = "data/kernels/de440.bsp";
const GM = "data/kernels/gm_de440.tpc";
const OUT_SPK = "public/ephemeris/de440-earth-moon-sun.bsp";
const OUT_MANIFEST = "public/ephemeris/de440-earth-moon-sun.json";

type SourceEntry = { filename: string; url: string; sha256: string };

function etAtUtcCalendar(year: number, month: number, day: number): number {
  const { djm0, djm } = cal2jd(year, month, day);
  return (djm0 + djm - J2000_JD) * DAYSEC;
}

function gm(text: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*\\(\\s*([0-9.DEde+-]+)\\s*\\)`).exec(text);
  if (!match) throw new Error(`Missing ${name}`);
  return Number(match[1].replace(/D/g, "E"));
}

describe.skipIf(process.env.CUT_DE440 !== "1")("DE440 planetary cut", () => {
  it("writes native segments and a manifest", () => {
    const sources = JSON.parse(readFileSync("kernels/sources.json", "utf8")) as { files: SourceEntry[] };
    const spkSource = sources.files.find((entry) => entry.filename === "de440.bsp");
    const gmSource = sources.files.find((entry) => entry.filename === "gm_de440.tpc");
    if (!spkSource || !gmSource) throw new Error("kernels/sources.json is missing DE440");
    const sourceBytes = readFileSync(SOURCE);
    expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(spkSource.sha256);
    const source = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    const startEt = etAtUtcCalendar(1950, 1, 1);
    const stopEt = etAtUtcCalendar(2050, 1, 1);
    const cut = cutSpk(source, [...SNAPSHOT_TARGETS], startEt, stopEt);
    expect(cut.segments.map((segment) => segment.target)).toEqual([...SNAPSHOT_TARGETS]);
    for (const segment of cut.segments) {
      expect(segment.type).toBe(2);
      expect(segment.frame).toBe(1);
      expect(segment.count).toBeGreaterThan(0);
    }
    const centerOf = (target: number) => cut.segments.find((segment) => segment.target === target)?.center;
    for (const target of [1, 2, 3, 4, 5, 6, 7, 8, 9, SUN]) expect(centerOf(target)).toBe(0);
    expect(centerOf(199)).toBe(1);
    expect(centerOf(299)).toBe(2);
    expect(centerOf(MOON)).toBe(EMB);
    expect(centerOf(EARTH)).toBe(EMB);
    const gmText = readFileSync(GM, "utf8");
    expect(createHash("sha256").update(gmText).digest("hex")).toBe(gmSource.sha256);
    const earthGm = gm(gmText, "BODY399_GM");
    const moonGm = gm(gmText, "BODY301_GM");
    const output = Buffer.from(cut.buffer);
    const manifest = {
      version: 1,
      product: "DE440 barycenters 1-9, Sun, Mercury, Venus, Earth-Moon barycenter, Moon, and Earth",
      source: {
        url: spkSource.url,
        sha256: spkSource.sha256,
      },
      constants: {
        url: gmSource.url,
        sha256: gmSource.sha256,
        body399GmKm3s2: earthGm,
        body301GmKm3s2: moonGm,
        emrat: earthGm / moonGm,
        note: "EMRAT is BODY399_GM / BODY301_GM from gm_de440.tpc. It is not read from an SPK segment. The native Earth segment is the served state.",
      },
      frame: "NAIF frame 1 on this DE440 kernel is ICRF, not dynamical EME2000.",
      units: "kilometers and kilometers per second in the SPK. The application API converts to meters once.",
      time: "TDB seconds past J2000. The cut window is the Julian dates of 1950-01-01 and 2050-01-01 at 0h, expanded to native interval boundaries.",
      placement: "Ids 499 through 999 are not in this cut. The page adds the circle-rule offset onto barycenters 4 through 9. Mercury 199 and Venus 299 are the native planet-center segments.",
      requestedWindowEt: [startEt, stopEt],
      segments: cut.segments,
      output: {
        file: "de440-earth-moon-sun.bsp",
        bytes: cut.buffer.byteLength,
        sha256: createHash("sha256").update(output).digest("hex"),
      },
    };
    mkdirSync("public/ephemeris", { recursive: true });
    writeFileSync(OUT_SPK, output);
    writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(cut.buffer.byteLength).toBeGreaterThan(1_000_000);
  });
});
