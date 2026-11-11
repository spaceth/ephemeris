# Ephemeris

A static viewer for one CCSDS Orbit Ephemeris Message. Open a local OEM, inspect it, and play the trajectory about its orbit center in EME2000. The file and the trajectory stay in the browser. Right ascension and declination of the center-relative position are calculated and are not plotted.

## Run

```sh
npm install
npm run dev
```

Other checks:

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run build` writes static files to `dist/`. The bundled samples are `public/sample/EM2.oem`, a copy of `example.oem`, `public/sample/CE7_Trajectory_2027.oem`, and `public/sample/dart_2021_328_2022_091_rec_v01.oem`.

## What you can open

OEM 2.0 and 3.0, KVN or XML, one OEM object, any number of segments. The format is detected from the contents after a BOM and leading whitespace. The extension is only a picker hint. Files larger than 32 MB are rejected.

Preserved header and metadata: version, `CREATION_DATE`, `ORIGINATOR`, `MESSAGE_ID`, comments, and per segment `OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME`, `REF_FRAME`, `REF_FRAME_EPOCH`, `TIME_SYSTEM`, `START_TIME`, `STOP_TIME`, `USEABLE_START_TIME`, `USEABLE_STOP_TIME`, `INTERPOLATION`, and `INTERPOLATION_DEGREE`. Comments are shown as text. Covariance is kept and not drawn.

State rows are epoch, position, velocity, and optional acceleration. KVN units are km, km/s, and km/s². XML units are checked when present. Values are stored in meters. Samples outside the usable window are kept as interpolation support and are not part of the drawn arc.

Calculation requires:

- `TIME_SYSTEM = UTC`
- `CENTER_NAME` in the SANA orbit-center profile below
- `REF_FRAME` of `EME2000`, `GCRF`, or `ICRF`
- an interpolation method this viewer implements

Anything else still opens in the inspector. A view that needs the missing transform says why.

The center profile is the following subset of the SANA Orbit Centers registry (`https://sanaregistry.org/r/orbit_centers/`, updated 2023-05-17). Matching ignores case, repeated spaces, and parentheses around a leading catalog number.

EARTH, MOON, EARTH BARYCENTER, EARTH-MOON L1, EARTH-MOON L2, MERCURY, MERCURY BARYCENTER, VENUS, VENUS BARYCENTER, MARS, MARS BARYCENTER, JUPITER, JUPITER BARYCENTER, SATURN, SATURN BARYCENTER, URANUS, URANUS BARYCENTER, NEPTUNE, NEPTUNE BARYCENTER, PLUTO, PLUTO BARYCENTER, SUN, SOLAR SYSTEM BARYCENTER, SUN-EARTH L1, SUN-EARTH L2, 1 CERES, 4 VESTA, 16 PSYCHE, 21 LUTETIA, 243 IDA, 253 MATHILDE, 433 EROS, 951 GASPRA, 2867 STEINS, 3200 PHAETHON, 3548 EURYBATES, 4179 TOUTATIS, 5525 ANNEFRANK, 617 PATROCLUS, 9969 BRAILLE, 11351 LEUCUS, 15094 POLYMELE, 21900 ORUS, 25143 ITOKAWA, 52246 DONALDJOHANSON, 65803 DIDYMOS/DIMORPHOS, 101955 BENNU, 132524 APL, 162173 RYUGU, ARROKOTH.

Segments that name different centers are not translated onto one origin. The clock follows the segment that covers the epoch and draws that center, plus the other segments that share it.

Interpolation:

- omitted method and degree: two-node cubic Hermite, labeled **Viewer default — cubic Hermite**
- `LINEAR` with no degree or degree 1
- `LAGRANGE` at integer degrees 1 through 12. Velocity is a separate series
- `HERMITE` at degrees 3, 5, 7, 9, and 11

There is no extrapolation and no SGP4. An exact sample epoch returns the stored state. Overlapping usable windows are not merged. The segment already in view stays while it still covers the epoch. Otherwise the clock uses the covering segment that started latest. A shared boundary with two states is a discontinuity.

## Coordinates

The working axes are EME2000. The scene origin is the center of the segment being shown. An EME2000 file is used as stored. A GCRF or ICRF file is treated as GCRS and rotated by the IAU 2006 frame bias frozen at J2000.0. ICRF uses the same axes as GCRF in this profile. That bias is the constant matrix in `src/core/frames.ts`.

Scene axes are Y-up. A science vector in meters becomes `(X, Z, −Y)` in kilometers. The Sun is an untextured sphere of the IAU nominal solar radius. Moon, Pluto, and the planets are gray spheres of a published equatorial radius (Earth uses WGS84). A sphere is not rotated, because it has no longitude. Barycenters, Lagrange points, and the listed small bodies are an origin mark. The center and the spacecraft each carry a white label.

Right ascension and declination are the direction of that center-relative EME2000 vector. They are geocentric only when the center is Earth. There is no light-time, aberration, refraction, or apparent place. Right ascension is undefined on the celestial pole and at the origin. They are not drawn as a sky plot.

## Reference data

Leap seconds: IERS `leap-seconds.list`, retrieved 2026-11-11, expires 2027-06-28. TAI−UTC is 37 s from 2017-01-01. Instants after the expiry still use 37 s and are marked dubious. UTC before 1972 is rejected. The scientific clock is a split TAI Julian Date, not `Date` and not POSIX milliseconds.

## Tests and limits

Interpolation tests use analytic polynomials. The 2016-12-31 leap second is checked on the TAI scale. Right ascension is checked for the wrap at 0 h and for an undefined value on the pole. `example.oem` is the NASA/JSC EM-2 ephemeris included with this repository (EME2000, UTC, April 2026). It is not an independent orbit determination, and these checks are not an Orekit or Horizons comparison. Do not read them as a pointing-accuracy claim.

## Updating the leap-second table

Leap seconds come from the IERS `leap-seconds.list` bulletin. The table in `src/core/time.ts` must match it, including the expiry date.

The page loads the Adobe Fonts kit named in `design.md` for Thai glyphs, and Poppins from the bundle. Opening a local OEM does not upload it. The sample button requests only a bundled example.
