import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  centerKey,
  earthEmeFromItrf,
  earthEpochs,
  earthScene,
  fromScene,
  GCRS_TO_EME2000,
  gmst,
  liveSeconds,
  ORBIT_CENTERS,
  orbitCenter,
  parseOem,
  radecEme2000,
  segmentAtTime,
  sourceToEme2000,
  stateAt,
  starColor,
  starDirection,
  starPointSize,
  starScene,
  sunEme2000,
  moonEmeFromBody,
  moonScene,
  toScene,
} from "../src/core";
import { hermiteCubic } from "../src/core/interpolate";
import { arcsForCenter, buildArcs } from "../src/session";
import { parseUtcEpoch, taiSecondsBetween } from "../src/core/time";
import { readableUtc } from "../src/view/format";

const DEG = Math.PI / 180;

function kvn(meta: string, rows: string): string {
  const times = rows
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0]);
  return `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2020-01-01T00:00:00
ORIGINATOR = TEST
COMMENT kept as text
META_START
OBJECT_NAME = DEMO
OBJECT_ID = 2020-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = ${times[0]}
STOP_TIME = ${times[times.length - 1]}
${meta}
META_STOP
${rows.trim()}
`;
}

describe("time scales", () => {
  it("treats the 2016-12-31 leap second as one SI second on either side", () => {
    const before = parseUtcEpoch("2016-12-31T23:59:59");
    const leap = parseUtcEpoch("2016-12-31T23:59:60");
    const after = parseUtcEpoch("2017-01-01T00:00:00");
    const a = taiSecondsBetween(leap.tai1, leap.tai2, before.tai1, before.tai2);
    const b = taiSecondsBetween(after.tai1, after.tai2, leap.tai1, leap.tai2);
    expect(a).toBeCloseTo(1, 9);
    expect(b).toBeCloseTo(1, 9);
  });

  it("accepts calendar and day-of-year UTC as the same instant", () => {
    const cal = parseUtcEpoch("2026-04-02T00:00:00");
    const doy = parseUtcEpoch("2026-092T00:00:00");
    expect(taiSecondsBetween(cal.tai1, cal.tai2, doy.tai1, doy.tai2)).toBeCloseTo(0, 9);
  });

  it("reads a UTC epoch as a calendar date ahead of the ISO form", () => {
    expect(readableUtc("2026-01-01T12:00:00.000")).toBe("1 January 2026 UTC 12:00:00");
    expect(readableUtc("2026-04-02T01:57:37.084")).toBe("2 April 2026 UTC 01:57:37");
    expect(readableUtc("2016-12-31T23:59:60.000")).toBe("31 December 2016 UTC 23:59:60");
    expect(readableUtc("not-a-time")).toBeNull();
  });

  it("rejects a leap second on an ordinary day", () => {
    expect(() => parseUtcEpoch("2020-01-01T23:59:60")).toThrow(/Second/);
  });

  it("allows live only while the current UTC is inside coverage", () => {
    const file = parseOem(kvn("", "2026-04-02T00:00:00 7000 0 0 0 7 0\n2026-04-03T00:00:00 7100 0 0 0 7 0"));
    const inside = new Date(Date.UTC(2026, 3, 2, 12, 0, 0));
    const outside = new Date(Date.UTC(2026, 10, 11, 0, 0, 0));
    const at = liveSeconds(file, inside);
    expect(at).toBeCloseTo(12 * 3600, 3);
    expect(liveSeconds(file, outside)).toBeNull();
  });
});

describe("EME2000", () => {
  it("leaves an EME2000 vector unchanged and applies the frozen GCRF bias", () => {
    expect(sourceToEme2000("EME2000", [1, 2, 3])).toEqual([1, 2, 3]);
    const got = sourceToEme2000("GCRF", [1, 0, 0]);
    expect(got[0]).toBeCloseTo(GCRS_TO_EME2000[0][0], 15);
    expect(got[1]).toBeCloseTo(GCRS_TO_EME2000[1][0], 15);
    expect(got[2]).toBeCloseTo(GCRS_TO_EME2000[2][0], 15);
  });

  it("keeps the EME2000 frame bias a tiny proper rotation", () => {
    const r = GCRS_TO_EME2000;
    const product = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        product[i * 3 + j] = r[0][i] * r[0][j] + r[1][i] * r[1][j] + r[2][i] * r[2][j];
      }
    }
    expect(product[0]).toBeCloseTo(1, 12);
    expect(product[4]).toBeCloseTo(1, 12);
    expect(product[8]).toBeCloseTo(1, 12);
    expect(Math.abs(product[1])).toBeLessThan(1e-12);
    const tilt = Math.hypot(r[0][1], r[0][2], r[1][0]);
    expect(tilt).toBeGreaterThan(1e-8);
    expect(tilt).toBeLessThan(1e-5);
  });
});

describe("geometry", () => {
  it("wraps right ascension and leaves it undefined on the pole", () => {
    const west = radecEme2000([1, -1e-8, 0]);
    const east = radecEme2000([1, 1e-8, 0]);
    const pole = radecEme2000([0, 0, 1]);
    expect(west.raRad!).toBeGreaterThan(2 * Math.PI - 1e-6);
    expect(east.raRad!).toBeLessThan(1e-6);
    expect(pole.raRad).toBeNull();
    expect(pole.decRad / DEG).toBeCloseTo(90, 8);
  });

  it("maps science axes into the Y-up scene in kilometers", () => {
    expect(toScene(1000, 2000, 3000)).toEqual([1, 3, -2]);
    expect(fromScene(1, 3, -2)).toEqual([1000, 2000, 3000]);
  });
});

describe("interpolation", () => {
  it("reproduces a cubic with the specified Hermite formula", () => {
    const got = hermiteCubic(0, 0, 0, 1, 1, 3, 0.5);
    expect(got.p).toBeCloseTo(0.125, 12);
    expect(got.v).toBeCloseTo(0.75, 12);
  });

  it("returns the stored state at an endpoint and the cubic between samples", () => {
    const file = parseOem(
      kvn(
        "",
        `2020-01-01T00:00:00.000 0 0 0 0 0 0
2020-01-01T00:00:01.000 0.001 0 0 0.003 0 0`,
      ),
    );
    expect(file.segments[0].plan.label).toBe("Viewer default — cubic Hermite");
    const end = stateAt(file, 0);
    expect(end.ok && end.exactSample && end.positionM[0]).toBe(0);
    const mid = stateAt(file, 0.5);
    expect(mid.ok).toBe(true);
    if (mid.ok) {
      expect(mid.positionM[0]).toBeCloseTo(0.125, 9);
      expect(mid.velocityMps[0]).toBeCloseTo(0.75, 9);
    }
  });

  it("interpolates Lagrange position and velocity as separate series", () => {
    const file = parseOem(
      kvn(
        "INTERPOLATION = LAGRANGE\nINTERPOLATION_DEGREE = 2",
        `2020-01-01T00:00:00 0 0 0 0 0 0
2020-01-01T00:00:01 0.001 0 0 0.002 0 0
2020-01-01T00:00:02 0.004 0 0 0.004 0 0`,
      ),
    );
    const mid = stateAt(file, 1.5);
    expect(mid.ok).toBe(true);
    if (mid.ok) {
      expect(mid.positionM[0]).toBeCloseTo(2.25, 8);
      expect(mid.velocityMps[0]).toBeCloseTo(3, 8);
    }
  });

  it("does not interpolate across a segment boundary", () => {
    const text = `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2020-01-01T00:00:00
ORIGINATOR = TEST
META_START
OBJECT_NAME = A
OBJECT_ID = 1
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2020-01-01T00:00:00
STOP_TIME = 2020-01-01T00:00:10
META_STOP
2020-01-01T00:00:00 0 0 0 0 0 0
2020-01-01T00:00:10 0.001 0 0 0 0 0
META_START
OBJECT_NAME = A
OBJECT_ID = 1
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2020-01-01T00:00:10
STOP_TIME = 2020-01-01T00:00:20
META_STOP
2020-01-01T00:00:10 5 0 0 0 0 0
2020-01-01T00:00:20 5.001 0 0 0 0 0
`;
    const file = parseOem(text);
    const insideSecond = stateAt(file, 15);
    expect(insideSecond.ok).toBe(true);
    if (insideSecond.ok) expect(insideSecond.positionM[0]).toBeGreaterThan(5000);
    const boundary = stateAt(file, 10);
    expect(boundary.ok).toBe(false);
    if (!boundary.ok) expect(boundary.reason).toBe("ambiguous-segment");
    const chosen = stateAt(file, 10, 1);
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.positionM[0]).toBeCloseTo(5000, 6);
    const gapped = parseOem(`CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2020-01-01T00:00:00
ORIGINATOR = TEST
META_START
OBJECT_NAME = A
OBJECT_ID = 1
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2020-01-01T00:00:00
STOP_TIME = 2020-01-01T00:00:10
META_STOP
2020-01-01T00:00:00 0 0 0 0 0 0
2020-01-01T00:00:10 0.001 0 0 0 0 0
META_START
OBJECT_NAME = A
OBJECT_ID = 1
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2020-01-01T00:00:20
STOP_TIME = 2020-01-01T00:00:30
META_STOP
2020-01-01T00:00:20 9 0 0 0 0 0
2020-01-01T00:00:30 9.001 0 0 0 0 0
`);
    const gap = stateAt(gapped, 15);
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.reason).toBe("gap");
  });
});

describe("segment clock", () => {
  const file = parseOem(`CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2020-01-01T00:00:00
ORIGINATOR = TEST
META_START
OBJECT_NAME = A
OBJECT_ID = 1
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2020-01-01T00:00:00
STOP_TIME = 2020-01-01T00:00:20
META_STOP
2020-01-01T00:00:00 0 0 0 0 0 0
2020-01-01T00:00:20 1 0 0 0 0 0
META_START
OBJECT_NAME = A
OBJECT_ID = 1
CENTER_NAME = SUN
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2020-01-01T00:00:10
STOP_TIME = 2020-01-01T00:00:30
META_STOP
2020-01-01T00:00:10 2 0 0 0 0 0
2020-01-01T00:00:30 3 0 0 0 0 0
META_START
OBJECT_NAME = A
OBJECT_ID = 1
CENTER_NAME = MOON
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2020-01-01T00:00:40
STOP_TIME = 2020-01-01T00:00:50
META_STOP
2020-01-01T00:00:40 4 0 0 0 0 0
2020-01-01T00:00:50 5 0 0 0 0 0
`);

  it("stays on the current segment until the clock leaves it", () => {
    expect(segmentAtTime(file, 15, 0)).toBe(0);
    expect(segmentAtTime(file, 15, 1)).toBe(1);
    expect(segmentAtTime(file, 25, 0)).toBe(1);
    expect(segmentAtTime(file, 35, 1)).toBe(1);
    expect(segmentAtTime(file, 45, 1)).toBe(2);
    expect(segmentAtTime(file, 12, 0)).toBe(0);
  });

  it("enters the segment that started latest when the current one does not cover the epoch", () => {
    expect(segmentAtTime(file, 15, 2)).toBe(1);
  });
});

describe("parser", () => {
  it("reads equivalent KVN and XML, including a comment and unused covariance", () => {
    const kvnText = `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2020-06-01T00:00:00
ORIGINATOR = XML
MESSAGE_ID = demo
COMMENT do not render
META_START
OBJECT_NAME = DEMO
OBJECT_ID = 99
CENTER_NAME = EARTH
REF_FRAME = GCRF
TIME_SYSTEM = UTC
START_TIME = 2020-06-01T00:00:00
USEABLE_START_TIME = 2020-06-01T00:00:00
USEABLE_STOP_TIME = 2020-06-01T00:01:00
STOP_TIME = 2020-06-01T00:01:00
META_STOP
2020-06-01T00:00:00 1 2 3 0.1 0.2 0.3 0.01 0.02 0.03
2020-06-01T00:01:00 1.1 2 3 0.1 0.2 0.3 0.01 0.02 0.03
COVARIANCE_START
EPOCH = 2020-06-01T00:00:00
1 0 0
COVARIANCE_STOP
`;
    const xml = `<?xml version="1.0"?>
<ndm>
  <oem version="2.0">
    <header>
      <COMMENT>do not render</COMMENT>
      <CREATION_DATE>2020-06-01T00:00:00</CREATION_DATE>
      <ORIGINATOR>XML</ORIGINATOR>
      <MESSAGE_ID>demo</MESSAGE_ID>
    </header>
    <body>
      <segment>
        <metadata>
          <OBJECT_NAME>DEMO</OBJECT_NAME>
          <OBJECT_ID>99</OBJECT_ID>
          <CENTER_NAME>EARTH</CENTER_NAME>
          <REF_FRAME>GCRF</REF_FRAME>
          <TIME_SYSTEM>UTC</TIME_SYSTEM>
          <START_TIME>2020-06-01T00:00:00</START_TIME>
          <USEABLE_START_TIME>2020-06-01T00:00:00</USEABLE_START_TIME>
          <USEABLE_STOP_TIME>2020-06-01T00:01:00</USEABLE_STOP_TIME>
          <STOP_TIME>2020-06-01T00:01:00</STOP_TIME>
        </metadata>
        <data>
          <stateVector>
            <EPOCH>2020-06-01T00:00:00</EPOCH>
            <X units="km">1</X><Y units="km">2</Y><Z units="km">3</Z>
            <X_DOT units="km/s">0.1</X_DOT><Y_DOT units="km/s">0.2</Y_DOT><Z_DOT units="km/s">0.3</Z_DOT>
            <X_DDOT units="km/s2">0.01</X_DDOT><Y_DDOT units="km/s2">0.02</Y_DDOT><Z_DDOT units="km/s2">0.03</Z_DDOT>
          </stateVector>
          <stateVector>
            <EPOCH>2020-06-01T00:01:00</EPOCH>
            <X units="km">1.1</X><Y units="km">2</Y><Z units="km">3</Z>
            <X_DOT units="km/s">0.1</X_DOT><Y_DOT units="km/s">0.2</Y_DOT><Z_DOT units="km/s">0.3</Z_DOT>
            <X_DDOT units="km/s2">0.01</X_DDOT><Y_DDOT units="km/s2">0.02</Y_DDOT><Z_DDOT units="km/s2">0.03</Z_DDOT>
          </stateVector>
        </data>
        <covarianceMatrix><COMMENT>unused</COMMENT></covarianceMatrix>
      </segment>
    </body>
  </oem>
</ndm>`;
    const a = parseOem(kvnText);
    const b = parseOem(xml);
    expect(a.comments.join(" ")).toContain("do not render");
    expect(a.covariances[0].unused).toBe(true);
    expect(a.segments[0].samples).toHaveLength(2);
    expect(a.segments[0].samples[0].accelerationMps2?.[0]).toBeCloseTo(10, 8);
    expect(b.segments[0].samples[0].positionM[0]).toBeCloseTo(a.segments[0].samples[0].positionM[0], 6);
    expect(b.segments[0].samples[0].velocityMps[1]).toBeCloseTo(200, 6);
    expect(b.covariances[0].unused).toBe(true);
    expect(b.messageId).toBe("demo");
  });

  it("rejects non-finite values, bad XML units, and a DOCTYPE", () => {
    const bad = kvn("", "2020-01-01T00:00:00 1 2 NaN 0 0 0\n2020-01-01T00:00:01 1 2 3 0 0 0");
    expect(() => parseOem(bad)).toThrow(/Non-finite|Malformed number/);
    const units = `<?xml version="1.0"?><ndm><oem version="2.0"><header><CREATION_DATE>2020-01-01T00:00:00</CREATION_DATE><ORIGINATOR>T</ORIGINATOR></header><body><segment><metadata><OBJECT_NAME>A</OBJECT_NAME><OBJECT_ID>1</OBJECT_ID><CENTER_NAME>EARTH</CENTER_NAME><REF_FRAME>EME2000</REF_FRAME><TIME_SYSTEM>UTC</TIME_SYSTEM><START_TIME>2020-01-01T00:00:00</START_TIME><STOP_TIME>2020-01-01T00:00:01</STOP_TIME></metadata><data><stateVector><EPOCH>2020-01-01T00:00:00</EPOCH><X units="m">1</X><Y units="km">0</Y><Z units="km">0</Z><X_DOT units="km/s">0</X_DOT><Y_DOT units="km/s">0</Y_DOT><Z_DOT units="km/s">0</Z_DOT></stateVector><stateVector><EPOCH>2020-01-01T00:00:01</EPOCH><X units="km">1</X><Y units="km">0</Y><Z units="km">0</Z><X_DOT units="km/s">0</X_DOT><Y_DOT units="km/s">0</Y_DOT><Z_DOT units="km/s">0</Z_DOT></stateVector></data></segment></body></oem></ndm>`;
    expect(() => parseOem(units)).toThrow(/units/);
    expect(() => parseOem(`<!DOCTYPE ndm [<!ENTITY x SYSTEM "http://example.invalid">]><ndm>&x;</ndm>`)).toThrow(/DOCTYPE/);
  });

  it("keeps an unsupported frame inspectable", () => {
    const file = parseOem(
      kvn("", "2020-01-01T00:00:00 7000 0 0 0 7 0\n2020-01-01T00:00:10 7001 0 0 0 7 0").replace(
        "REF_FRAME = EME2000",
        "REF_FRAME = ITRF2000",
      ),
    );
    expect(file.segments[0].refFrame).toBe("ITRF2000");
    expect(file.segments[0].calculationSupported).toBe(false);
    const state = stateAt(file, 0);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.eme2000PositionM).toBeNull();
      expect(state.raRad).toBeNull();
      expect(state.decRad).toBeNull();
    }
  });
});

describe("orbit line", () => {
  function nearest(positions: Float32Array, x: number, y: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < positions.length - 3; i += 3) {
      const abx = positions[i + 3] - positions[i];
      const aby = positions[i + 4] - positions[i + 1];
      const abz = positions[i + 5] - positions[i + 2];
      const apx = x - positions[i];
      const apy = y - positions[i + 1];
      const apz = z - positions[i + 2];
      const ab2 = abx * abx + aby * aby + abz * abz;
      const u = ab2 < 1e-12 ? 0 : Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / ab2));
      const dist = Math.hypot(apx - abx * u, apy - aby * u, apz - abz * u);
      if (dist < best) best = dist;
    }
    return best;
  }

  it("follows the interpolant between samples instead of the chord", () => {
    const file = parseOem(kvn("", "2020-01-01T00:00:00 7000 0 0 0 7.5 0\n2020-01-01T00:04:00 6800 1800 0 -2 7 0"));
    const arc = buildArcs(file)[0];
    expect(arc.positions.length / 3).toBeGreaterThan(2);
    expect(arc.times.length).toBe(arc.positions.length / 3);
    for (let i = 1; i < arc.times.length; i += 1) expect(arc.times[i]).toBeGreaterThan(arc.times[i - 1]);
    const start = file.segments[0].evalStart ?? 0;
    const stop = file.segments[0].evalStop ?? 0;
    for (let step = 0; step <= 16; step += 1) {
      const state = stateAt(file, start + ((stop - start) * step) / 16, 0);
      expect(state.ok).toBe(true);
      if (!state.ok || !state.eme2000PositionM) continue;
      const [x, y, z] = state.eme2000PositionM;
      expect(nearest(arc.positions, x, y, z)).toBeLessThan(2000);
    }
  });

  it("leaves a linear ephemeris as the sample chords", () => {
    const file = parseOem(
      kvn("INTERPOLATION = LINEAR", "2020-01-01T00:00:00 7000 0 0 0 7.5 0\n2020-01-01T00:04:00 6800 1800 0 -2 7 0"),
    );
    const arc = buildArcs(file)[0];
    expect(arc.positions.length / 3).toBe(2);
    expect(Array.from(arc.times)).toEqual([
      file.segments[0].samples[0].t,
      file.segments[0].samples[1].t,
    ]);
  });
});

describe("orbit centers", () => {
  const sana = [
    "EARTH",
    "MOON",
    "EARTH BARYCENTER",
    "EARTH-MOON L1",
    "EARTH-MOON L2",
    "JUPITER",
    "JUPITER BARYCENTER",
    "MARS",
    "MARS BARYCENTER",
    "MERCURY",
    "MERCURY BARYCENTER",
    "NEPTUNE",
    "NEPTUNE BARYCENTER",
    "SATURN",
    "SATURN BARYCENTER",
    "SOLAR SYSTEM BARYCENTER",
    "SUN",
    "SUN-EARTH L1",
    "SUN-EARTH L2",
    "URANUS",
    "URANUS BARYCENTER",
    "VENUS",
    "VENUS BARYCENTER",
    "101955 BENNU",
    "11351 LEUCUS",
    "132524 APL",
    "15094 POLYMELE",
    "162173 RYUGU",
    "16 PSYCHE",
    "1 CERES",
    "21900 ORUS",
    "21 LUTETIA",
    "243 IDA",
    "25143 ITOKAWA",
    "253 MATHILDE",
    "2867 STEINS",
    "3200 PHAETHON",
    "3548 EURYBATES",
    "4179 TOUTATIS",
    "433 EROS",
    "4 VESTA",
    "52246 DONALDJOHANSON",
    "5525 ANNEFRANK",
    "617 PATROCLUS",
    "65803 DIDYMOS/DIMORPHOS",
    "951 GASPRA",
    "9969 BRAILLE",
    "ARROKOTH",
    "PLUTO",
    "PLUTO BARYCENTER",
  ];

  it("recognizes the SANA profile and the spellings an OEM is likely to use", () => {
    expect(ORBIT_CENTERS.map((center) => center.name)).toEqual(sana);
    expect(orbitCenter("sun")?.name).toBe("SUN");
    expect(orbitCenter("(433) EROS")?.name).toBe("433 EROS");
    expect(orbitCenter("65803 DIDYMOS / DIMORPHOS")?.name).toBe("65803 DIDYMOS/DIMORPHOS");
    expect(orbitCenter("sun - earth l2")?.name).toBe("SUN-EARTH L2");
    expect(centerKey("  earth   barycenter ")).toBe("EARTH BARYCENTER");
    expect(orbitCenter("PHOBOS")).toBeNull();
    expect(orbitCenter("EARTH")?.radiusKm).toBeCloseTo(6378.137, 3);
    expect(orbitCenter("EARTH")?.radiusKm).not.toBeCloseTo(6378.1366, 6);
    expect(orbitCenter("SUN")?.radiusKm).toBe(695700);
    expect(orbitCenter("MERCURY")?.radiusKm).toBeCloseTo(2440.53, 2);
    expect(orbitCenter("MOON")?.radiusKm).toBeCloseTo(1737.4, 1);
    expect(orbitCenter("PLUTO")?.radiusKm).toBeCloseTo(1188.3, 1);
    expect(orbitCenter("65803 DIDYMOS/DIMORPHOS")?.radiusKm).toBeNull();
  });

  it("evaluates a Sun-centered ICRF segment without mixing it into an Earth arc", () => {
    const file = parseOem(`CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2021-11-24T00:00:00
ORIGINATOR = TEST
META_START
OBJECT_NAME = DART
OBJECT_ID = 2021-110A
CENTER_NAME = EARTH
REF_FRAME = ICRF
TIME_SYSTEM = UTC
START_TIME = 2021-11-24T07:16:43.817
STOP_TIME = 2021-11-24T07:17:43.817
INTERPOLATION = HERMITE
INTERPOLATION_DEGREE = 3
META_STOP
2021-11-24T07:16:43.817 -9133.152291446924 -7851.170895174146 -6578.823413223028 -3.936042689017672 -6.878375617485837 1.332930223515555
2021-11-24T07:17:43.817 -9366.822550453639 -8261.712295082447 -6497.074607502298 -3.853670879873274 -6.806644314641206 1.391165118349333
META_START
OBJECT_NAME = DART
OBJECT_ID = 2021-110A
CENTER_NAME = SUN
REF_FRAME = ICRF
TIME_SYSTEM = UTC
START_TIME = 2021-11-27T19:35:28.624
STOP_TIME = 2021-11-27T19:36:28.624
INTERPOLATION = HERMITE
INTERPOLATION_DEGREE = 3
META_STOP
2021-11-27T19:35:28.624 6.099203429564641e+07 1.224436357249959e+08 5.384883748073384e+07 -28.33093817186868 9.014711090291378 6.215886368968871
2021-11-27T19:36:28.624 6.099033443501563e+07 1.224441765991609e+08 5.384921042946708e+07 -28.33108282484940 9.014427730766865 6.215738066754757
`);
    expect(file.segments[0].calculationSupported).toBe(true);
    expect(file.segments[1].calculationSupported).toBe(true);
    expect(file.segments[1].refFrame).toBe("ICRF");
    const sun = stateAt(file, file.segments[1].evalStart ?? 0, 1);
    expect(sun.ok).toBe(true);
    if (sun.ok) {
      expect(sun.positionM[0]).toBeCloseTo(Number("6.099203429564641e+07") * 1000, 3);
      const turned = sourceToEme2000("ICRF", sun.positionM);
      expect(sun.eme2000PositionM?.[0]).toBeCloseTo(turned[0], 4);
      expect(sun.raRad).not.toBeNull();
    }
    const arcs = buildArcs(file);
    expect(arcs.map((arc) => arc.segmentIndex)).toEqual([0, 1]);
    expect(arcsForCenter(file, arcs, 0).map((arc) => arc.segmentIndex)).toEqual([0]);
    expect(arcsForCenter(file, arcs, 1).map((arc) => arc.segmentIndex)).toEqual([1]);
    const outside = parseOem(
      kvn("", "2020-01-01T00:00:00 1 0 0 0 0 0\n2020-01-01T00:00:10 2 0 0 0 0 0").replace(
        "CENTER_NAME = EARTH",
        "CENTER_NAME = PHOBOS",
      ),
    );
    expect(outside.segments[0].calculationSupported).toBe(false);
    expect(outside.segments[0].unsupportedReason).toMatch(/SANA/);
    expect(buildArcs(outside)).toEqual([]);
  });

  it("reads the DART reconstruction and keeps Earth and Sun apart", () => {
    const file = parseOem(readFileSync(new URL("../public/sample/dart_2021_328_2022_091_rec_v01.oem", import.meta.url), "utf8"));
    expect(file.segments.length).toBeGreaterThan(2);
    expect(file.segments[0].objectName).toBe("DART");
    expect(file.segments[0].centerName).toBe("EARTH");
    expect(file.segments[0].refFrame).toBe("ICRF");
    expect(file.segments.every((segment) => segment.calculationSupported)).toBe(true);
    expect(new Set(file.segments.map((segment) => segment.centerName))).toEqual(new Set(["EARTH", "SUN"]));
    const earth = stateAt(file, file.segments[0].samples[0].t ?? 0, 0);
    expect(earth.ok).toBe(true);
    if (earth.ok) expect(earth.positionM[0]).toBeCloseTo(Number("-9.133152291446924e+03") * 1000, 3);
    const sunIndex = file.segments.findIndex((segment) => segment.centerName === "SUN");
    const sun = stateAt(file, file.segments[sunIndex].samples[0].t ?? 0, sunIndex);
    expect(sun.ok).toBe(true);
    if (sun.ok) expect(sun.positionM[0]).toBeCloseTo(Number("6.099203429564641e+07") * 1000, 3);
    const arcs = buildArcs(file);
    expect(arcsForCenter(file, arcs, 0).every((arc) => file.segments[arc.segmentIndex].centerName === "EARTH")).toBe(true);
    expect(arcsForCenter(file, arcs, sunIndex).every((arc) => file.segments[arc.segmentIndex].centerName === "SUN")).toBe(true);
    expect(arcsForCenter(file, arcs, sunIndex).some((arc) => arc.segmentIndex === 0)).toBe(false);
  }, 120_000);
});

describe("sample OEM", () => {
  const file = parseOem(readFileSync(new URL("../public/sample/EM2.oem", import.meta.url), "utf8"));
  const ce7 = parseOem(readFileSync(new URL("../public/sample/CE7_Trajectory_2027.oem", import.meta.url), "utf8"));

  it("reads the EM-2 file and recovers the first state", () => {
    expect(file.segments[0].objectName).toBe("EM2");
    expect(file.segments[0].refFrame).toBe("EME2000");
    expect(file.segments[0].timeSystem).toBe("UTC");
    expect(file.segments[0].plan.viewerDefault).toBe(true);
    const first = file.segments[0].samples[0];
    const state = stateAt(file, first.t ?? 0);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.exactSample).toBe(true);
      expect(state.positionM[0]).toBeCloseTo(-24468.231698271986 * 1000, 4);
      expect(state.eme2000PositionM?.[0]).toBeCloseTo(state.positionM[0], 6);
      expect(state.raRad).not.toBeNull();
      expect(state.decRad).not.toBeNull();
      const again = radecEme2000(state.eme2000PositionM ?? [0, 0, 0]);
      expect(again.raRad).toBeCloseTo(state.raRad ?? 0, 12);
      expect(again.decRad).toBeCloseTo(state.decRad ?? 0, 12);
    }
  });

  it("reads the CE7 trajectory as Earth-centered EME2000", () => {
    expect(ce7.segments).toHaveLength(5);
    expect(ce7.segments.every((segment) => segment.objectName === "CE7")).toBe(true);
    expect(ce7.segments.every((segment) => segment.centerName === "EARTH" && segment.refFrame === "EME2000")).toBe(true);
    expect(ce7.segments.every((segment) => segment.calculationSupported)).toBe(true);
    const first = ce7.segments[0].samples[0];
    const state = stateAt(ce7, first.t ?? 0, 0);
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.positionM[0]).toBeCloseTo(357.5661416713739 * 1000, 3);
  });

  it("reads the LRO ephemeris as Moon-centered EME2000", () => {
    const lro = parseOem(readFileSync(new URL("../public/sample/lrorg_2009169_2010001_v01.oem", import.meta.url), "utf8"));
    expect(lro.segments).toHaveLength(197);
    expect(lro.segments.every((segment) => segment.objectName === "LUNAR RECONNAISSANCE ORBITER")).toBe(true);
    expect(lro.segments.every((segment) => segment.centerName === "MOON" && segment.refFrame === "EME2000")).toBe(true);
    expect(lro.segments.every((segment) => segment.calculationSupported)).toBe(true);
    const first = lro.segments[0].samples[0];
    expect(stateAt(lro, first.t ?? 0, 0).ok).toBe(true);
  }, 120_000);

  it("reads the Juno ephemeris as Jupiter-barycenter-centered EME2000", () => {
    const juno = parseOem(readFileSync(new URL("../public/sample/juno-2021-09-25_to_2021-11-08.oem", import.meta.url), "utf8"));
    expect(juno.segments).toHaveLength(3);
    expect(juno.segments.every((segment) => segment.objectName === "JUNO")).toBe(true);
    expect(juno.segments.every((segment) => segment.centerName === "JUPITER BARYCENTER" && segment.refFrame === "EME2000")).toBe(true);
    expect(juno.segments.every((segment) => segment.calculationSupported)).toBe(true);
    const first = juno.segments[0].samples[0];
    const state = stateAt(juno, first.t ?? 0, 0);
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.positionM[0]).toBeCloseTo(1.616979132320e6 * 1000, 3);
  }, 120_000);
});

describe("earth in EME2000", () => {
  const J2000 = 2451545.0;

  function column(m: readonly number[], index: number): [number, number, number] {
    return [m[index], m[3 + index], m[6 + index]];
  }

  it("puts Greenwich mean sidereal time at the J2000.0 value", () => {
    expect(gmst(J2000) * (180 / Math.PI)).toBeCloseTo(280.460618375, 6);
    const advance = (gmst(J2000 + 1) - gmst(J2000)) * (180 / Math.PI);
    expect(advance).toBeGreaterThan(0.98);
    expect(advance).toBeLessThan(0.99);
  });

  it("keeps the J2000 pole within the nutation and precesses it after a century", () => {
    const now = earthEmeFromItrf(J2000, J2000);
    const poleNow = column(now, 2);
    const tiltNow = Math.acos(Math.min(1, poleNow[2])) * (180 / Math.PI) * 3600;
    expect(tiltNow).toBeLessThan(30);

    const century = J2000 + 36525;
    const later = earthEmeFromItrf(century, century);
    const pole = column(later, 2);
    const tiltArcsec = Math.acos(Math.min(1, pole[2])) * (180 / Math.PI) * 3600;
    expect(tiltArcsec).toBeGreaterThan(1800);
    expect(tiltArcsec).toBeLessThan(2300);
    expect(pole[0]).toBeGreaterThan(0);
  });

  it("matches the scene axes used for ephemeris positions", () => {
    const eme = earthEmeFromItrf(J2000, J2000);
    const scene = earthScene(J2000, J2000);
    const meridian = column(eme, 0);
    const placed = column(scene, 0);
    expect(placed[0]).toBeCloseTo(meridian[0], 12);
    expect(placed[1]).toBeCloseTo(meridian[2], 12);
    expect(placed[2]).toBeCloseTo(-meridian[1], 12);
    const east = column(eme, 1);
    const eastScene = [
      scene[2] * -1,
      scene[5] * -1,
      scene[8] * -1,
    ];
    expect(eastScene[0]).toBeCloseTo(east[0], 12);
    expect(eastScene[1]).toBeCloseTo(east[2], 12);
    expect(eastScene[2]).toBeCloseTo(-east[1], 12);
  });

  it("places the Sun near the solstice declinations", () => {
    const winter = sunEme2000(J2000);
    const summer = sunEme2000(J2000 + 172);
    expect(Math.asin(winter[2]) * (180 / Math.PI)).toBeCloseTo(-23.0, 0);
    expect(Math.asin(summer[2]) * (180 / Math.PI)).toBeCloseTo(23.4, 0);
    const ra = Math.atan2(winter[1], winter[0]);
    let longitude = (ra - gmst(J2000)) * (180 / Math.PI);
    longitude = ((longitude + 540) % 360) - 180;
    expect(Math.abs(longitude)).toBeLessThan(1.5);
  });

  it("reads UT and TT from the file clock", () => {
    const parsed = parseUtcEpoch("2000-01-01T12:00:00");
    const epochs = earthEpochs({ tai1: parsed.tai1, tai2: parsed.tai2 }, 0);
    expect(epochs.jdUt1).toBeCloseTo(J2000, 8);
    expect((epochs.jdTt - epochs.jdUt1) * 86400).toBeCloseTo(64.184, 3);
    expect(epochs.ut1).toBe("approximate");
    expect(epochs.polarMotion).toBe("unavailable");
  });
});

describe("XHIP stars", () => {
  it("places Sirius on its J2000 position", () => {
    const sirius = starDirection(101.2872, -16.7161);
    const sky = radecEme2000(sirius);
    expect((sky.raRad ?? 0) * (180 / Math.PI)).toBeCloseTo(101.2872, 3);
    expect(sky.decRad * (180 / Math.PI)).toBeCloseTo(-16.7161, 3);
    const scene = starScene(101.2872, -16.7161);
    expect(scene[0]).toBeCloseTo(sirius[0], 12);
    expect(scene[1]).toBeCloseTo(sirius[2], 12);
    expect(scene[2]).toBeCloseTo(-sirius[1], 12);
  });

  it("treats a wrapped right ascension as the same direction", () => {
    const wrapped = starDirection(-146.0847, 19.1824);
    const full = starDirection(213.9153, 19.1824);
    expect(wrapped[0]).toBeCloseTo(full[0], 4);
    expect(wrapped[1]).toBeCloseTo(full[1], 4);
    expect(wrapped[2]).toBeCloseTo(full[2], 4);
  });

  it("draws brighter stars larger", () => {
    expect(starPointSize(-1.44)).toBeGreaterThan(starPointSize(0));
    expect(starPointSize(0)).toBeGreaterThan(starPointSize(6));
  });

  it("colors a hot star bluer than a cool star", () => {
    const hot = starColor(-0.3);
    const cool = starColor(1.85);
    expect(hot[2]).toBeGreaterThan(cool[2]);
    expect(cool[0]).toBeGreaterThan(hot[0]);
    expect(starColor(null)).toEqual([1, 1, 1]);
  });

  it("ships the magnitude 6 catalog", () => {
    const sky = JSON.parse(readFileSync("public/skymap.json", "utf8")) as {
      catalog: string;
      magnitudeLimit: number;
      stars: [number, number, number, number | null][];
    };
    expect(sky.catalog).toBe("XHIP");
    expect(sky.magnitudeLimit).toBe(6);
    expect(sky.stars).toHaveLength(5044);
    const sirius = sky.stars.find((star) => star[2] < -1);
    expect(sirius?.[0]).toBeCloseTo(101.2872, 3);
    expect(sirius?.[1]).toBeCloseTo(-16.7161, 3);
    expect(sky.stars.every((star) => star[2] <= 6)).toBe(true);
  });
});

describe("moon in EME2000", () => {
  const J2000 = 2451545.0;
  const DEG = Math.PI / 180;

  function column(m: readonly number[], index: number): [number, number, number] {
    return [m[index], m[3 + index], m[6 + index]];
  }

  function apply(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }

  /** Low-precision geocentric Moon direction, Meeus. Enough to catch a flipped meridian. */
  function moonDirection(jd: number): [number, number, number] {
    const t = (jd - J2000) / 36525;
    const lp = (218.3164477 + 481267.88123421 * t) * DEG;
    const d = (297.8501921 + 445267.1114034 * t) * DEG;
    const m = (357.5291092 + 35999.0502909 * t) * DEG;
    const mp = (134.9633964 + 477198.8675055 * t) * DEG;
    const f = (93.272095 + 483202.0175233 * t) * DEG;
    const lon =
      lp +
      DEG *
        (6.288774 * Math.sin(mp) +
          1.274027 * Math.sin(2 * d - mp) +
          0.658314 * Math.sin(2 * d) +
          0.213618 * Math.sin(2 * mp) -
          0.185116 * Math.sin(m) -
          0.114332 * Math.sin(2 * f));
    const lat =
      DEG *
      (5.128122 * Math.sin(f) +
        0.280606 * Math.sin(mp + f) +
        0.277693 * Math.sin(mp - f) +
        0.173238 * Math.sin(2 * d - f));
    const eps = 23.4392911 * DEG;
    const x = Math.cos(lat) * Math.cos(lon);
    const y = Math.cos(eps) * Math.cos(lat) * Math.sin(lon) - Math.sin(eps) * Math.sin(lat);
    const z = Math.sin(eps) * Math.cos(lat) * Math.sin(lon) + Math.cos(eps) * Math.sin(lat);
    const scale = Math.hypot(x, y, z);
    return [x / scale, y / scale, z / scale];
  }

  it("keeps the north pole on the IAU direction at J2000", () => {
    const body = moonEmeFromBody(J2000);
    const pole = column(body, 2);
    const ra = ((Math.atan2(pole[1], pole[0]) * (180 / Math.PI)) + 360) % 360;
    const dec = Math.asin(pole[2]) * (180 / Math.PI);
    expect(ra).toBeGreaterThan(260);
    expect(ra).toBeLessThan(275);
    expect(dec).toBeGreaterThan(64);
    expect(dec).toBeLessThan(69);
    const meridian = column(body, 0);
    expect(Math.hypot(meridian[0], meridian[1], meridian[2])).toBeCloseTo(1, 12);
    expect(meridian[0] * pole[0] + meridian[1] * pole[1] + meridian[2] * pole[2]).toBeCloseTo(0, 10);
  });

  it("points the prime meridian near the Earth", () => {
    const body = moonEmeFromBody(J2000);
    const moon = moonDirection(J2000);
    const earth: [number, number, number] = [-moon[0], -moon[1], -moon[2]];
    const transpose = [
      body[0], body[3], body[6],
      body[1], body[4], body[7],
      body[2], body[5], body[8],
    ];
    const seen = apply(transpose, earth);
    const longitude = Math.atan2(seen[1], seen[0]) * (180 / Math.PI);
    const latitude = Math.asin(seen[2]) * (180 / Math.PI);
    expect(Math.abs(longitude)).toBeLessThan(8);
    expect(Math.abs(latitude)).toBeLessThan(8);
  });

  it("matches the scene axes used for the Earth", () => {
    const eme = moonEmeFromBody(J2000);
    const scene = moonScene(J2000);
    const meridian = column(eme, 0);
    const placed = column(scene, 0);
    expect(placed[0]).toBeCloseTo(meridian[0], 12);
    expect(placed[1]).toBeCloseTo(meridian[2], 12);
    expect(placed[2]).toBeCloseTo(-meridian[1], 12);
    const pole = column(eme, 2);
    const poleScene = column(scene, 1);
    expect(poleScene[0]).toBeCloseTo(pole[0], 12);
    expect(poleScene[1]).toBeCloseTo(pole[2], 12);
    expect(poleScene[2]).toBeCloseTo(-pole[1], 12);
  });
});
