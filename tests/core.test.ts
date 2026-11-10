import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fromScene,
  GCRS_TO_EME2000,
  liveSeconds,
  parseOem,
  radecEme2000,
  sourceToEme2000,
  stateAt,
  toScene,
} from "../src/core";
import { hermiteCubic } from "../src/core/interpolate";
import { parseUtcEpoch, taiSecondsBetween } from "../src/core/time";

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

describe("sample OEM", () => {
  const file = parseOem(readFileSync(new URL("../example.oem", import.meta.url), "utf8"));

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
});
