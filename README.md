# Spaceth Ephemeris Visualization

A static viewer for one spacecraft trajectory and the solar-system bodies that can be placed around it. Open a local CCSDS Orbit Ephemeris Message or a NAIF SPK. The file stays in the browser. The scene origin is the center named by the segment on screen. Every other body is drawn relative to that center. Positions are geometric: light-time, stellar aberration, refraction, and apparent place are left out.

```sh
npm install
npm run dev
```

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are the checks. The build writes static files to `dist/`. Bundled OEM samples live in `public/sample/`.

## Layout

| Path | What it holds |
| --- | --- |
| `src/core/` | Time, frames, the orbit-center list, OEM parsing, and OEM interpolation. |
| `src/core/ephemeris/` | SPK reading, the body catalog, `place`, the planet-from-barycenter offset, Earth and Moon orientation. |
| `src/view/` | The scene, body meshes, labels, camera, and the panels. |
| `src/session.ts` | The open file, the clock, and the drawn arcs. |
| `public/sample/` | Example trajectories the welcome screen can open. EM-2, ISS, DART, CE7, LRO, and Juno. |
| `public/ephemeris/` | The planetary snapshot the page loads, plus a JSON manifest that names its source. |
| `public/textures/` | Earth, Moon, and Jupiter maps. |
| `kernels/sources.json` | Filename, NAIF URL, SHA-256, local path, and role for each kernel. |
| `kernels/pck00011.tpc` | The planetary-constants text kernel the page imports, under its NAIF name. |
| `data/kernels/` | The full `de440.bsp` and `gm_de440.tpc`. Gitignored. Used to rebuild the snapshot and the CSPICE fixtures. |
| `scripts/` | Kernel download, the DE440 cut helpers, and the Python fixture writers. |
| `tests/` | Evaluator checks, including CSPICE comparisons. |

`data/` is gitignored. It also holds the Python environment that runs CSPICE. That environment is a validation tool. It is not part of the page.

## What an open file becomes

Each file keeps its own evaluator. OEM playback interpolates the table. SPK playback reads the kernel.

An OEM is a table of Cartesian states. Between samples the viewer builds the interpolant the segment declares: linear, Lagrange, or Hermite. The result is a position and a velocity in meters, on the file’s time scale, in the file’s inertial frame, relative to the named center.

An SPK is a kernel of Chebyshev polynomials or discrete states. The evaluator picks the window that covers the requested time and returns a `CartesianState`: target and center as NAIF ids, frame, position in meters, velocity in meters per second, epoch, coverage, and a quality list. Kilometers stored in the kernel become meters once, at that boundary.

Playback then does the same thing for either kind of file:

1. Keep the clock in TAI seconds counted from the start of the file.
2. Evaluate the spacecraft in the segment’s own center and frame.
3. Turn that vector into EME2000 when the file used another supported frame.
4. Store the drawn arc as meters relative to the segment’s center.
5. At draw time, place that center relative to the center on screen, add the vertex, and map meters into the scene once.

The metadata panel keeps the file’s own center, frame, and numbers. The picture is the reduced vector. Those are two products.

## Structures

### Body catalog

`src/core/ephemeris/bodies.ts` is one drawing record per body the scene can place. `src/core/centers.ts` is the SANA name check: it decides whether a center name in a file can be evaluated, and it supplies the display radius. The catalog points at those names and adds the drawing fields: the on-screen label, the texture, the attitude, and how the body is chained.

Each `BodyRecord` carries:

| Field | Meaning |
| --- | --- |
| `id` | NAIF id. 399 is Earth. 3 is the Earth–Moon barycenter. 5 is the Jupiter barycenter. 599 is Jupiter. |
| `name` | Canonical SANA center name. |
| `label` | The name drawn on screen. |
| `radiusKm` | Equatorial radius used for the sphere. Empty for a barycenter, a Lagrange point, and a small body, which stay an origin mark. |
| `texture` | A map path, filled only for Earth, the Moon, and Jupiter. |
| `attitude` | `earth`, `moon`, or `none`. Only Earth and the Moon rotate. |
| `appearance` | Which mesh to use: Sun, Earth, Moon, Jupiter, or a plain sphere. |
| `placement` | `snapshot` when the id is in the cut kernel, or `barycenter-offset` when the planet is drawn a short distance from its system barycenter. |
| `chain` | The SPK target walked out to the solar-system barycenter. An offset planet walks its barycenter, then the offset is added. |

`place` is the one step that turns two catalog ids into a position. It returns EME2000 meters of the body relative to the viewing center. Both bodies are walked to the solar-system barycenter and subtracted. When the body is a planet that lives on its system barycenter, the circle-rule offset is added after that. If the snapshot cannot connect the two centers, the body is left out for that frame and the failure is kept as `unresolved-center`. It is not drawn on top of the origin.

A center with no NAIF id, such as Ceres or a Lagrange point, can still be the origin of its own arc. Other bodies are not chained onto it.

### States and arcs

An OEM sample stays on the OEM path: epoch, position, velocity, and the segment it belongs to. An SPK or planetary result is a `CartesianState`. Quality on that state says whether the numbers are the kernel’s own, an approximation, or a reconstruction. The approximations this page records are `tdb-equals-tt`, `barycenter-circle`, and `shared-inertial-axes`.

An `ArcBuffer` is one polyline. Its vertices are EME2000 meters relative to that segment’s center, plus a time from the file origin for each vertex. The camera fit uses the arcs that share the selected center. Arcs about other centers are still drawn, after `place` moves their center. The line is refined until a chord sits within 1.5 km of the interpolant. Two SPK pieces that meet within a meter are drawn as one arc. A larger jump stays two arcs.

### Scene

Scene axes are Y-up. Science axes are EME2000: X toward the equinox, Z toward the pole, Y completing the right-handed set. After the origin has been subtracted, meters become scene kilometers by sending the pole up and science Y toward scene −Z. That map is `toScene`. It runs once. It does not rotate the frame a second time.

Labels sit just above the body. When two names would cover each other, the spacecraft name and the neighbor names step aside. The center name stays on its body.

## Bodies on screen

The sized bodies are the Sun, the planets through Pluto, and the Moon. Barycenters have no radius. When the viewing center is a barycenter, the planet is a neighbor of that point. When the viewing center is the planet, the planet is the origin and is not drawn again.

| Body | NAIF id | How it is placed | Drawn radius (km) |
| --- | --- | --- | --- |
| Sun | 10 | Snapshot, relative to the solar-system barycenter | 695700 |
| Mercury | 199 | Snapshot, relative to the Mercury barycenter | 2440.53 |
| Venus | 299 | Snapshot, relative to the Venus barycenter | 6051.8 |
| Earth | 399 | Snapshot, relative to the Earth–Moon barycenter | 6378.137 |
| Moon | 301 | Snapshot, relative to the Earth–Moon barycenter | 1737.4 |
| Mars | 499 | Mars barycenter, then the circle-rule offset | 3396.19 |
| Jupiter | 599 | Jupiter barycenter, then the circle-rule offset | 71492 |
| Saturn | 699 | Saturn barycenter, then the circle-rule offset | 60268 |
| Uranus | 799 | Uranus barycenter, then the circle-rule offset | 25559 |
| Neptune | 899 | Neptune barycenter, then the circle-rule offset | 24764 |
| Pluto | 999 | Pluto barycenter, then the circle-rule offset | 1188.3 |

Radii other than Earth come from `kernels/pck00011.tpc` (Nat Bachman, 2022 December 27). The parser reads `\begindata` assignments, and a later assignment replaces an earlier one, so the historical numbers in the comment blocks are not the radii on screen. Each assignment is the body-fixed triple of semi-axes in kilometers. For the bodies above the first two axes match, and the mesh uses that equatorial radius. The polar axis is not drawn. Other `BODY*_RADII` values, including satellites, comets, and asteroids, are not display radii.

Earth does not use the kernel radius 6378.1366 km. Its sphere is the WGS 84 equatorial radius, 6378.137 km, by the ellipsoid definition.

### Planet beside its barycenter

DE440 stores Mars through Pluto as system barycenters, the balance point of the planet and its moons. The page still draws the planet a short distance from that point. The offset is calculated. It is not a kernel state.

Each large moon is treated as a circle in the planet’s equator. The equator is the J2000 pole from the same PCK, constant term only. Longitude starts from the published mean elements at 2000-01-01.5 and advances by one revolution per published period. A moon whose orbit is retrograde, such as Triton, runs the other way. The tilt of the moon’s orbit is dropped, so the circle stays in the equator.

The planet is then shifted the opposite way, weighted by each moon’s mass, so the balance point stays where the kernel put it. A moon is kept only when its share of that shift is at least a kilometer. That leaves Io, Europa, Ganymede, and Callisto; Rhea, Titan, and Iapetus; Ariel, Umbriel, Titania, and Oberon; Triton; and Charon. Mercury, Venus, and Mars come out with no shift, so the sphere sits on the barycenter. Jupiter’s shift stays inside the planet, under 250 km. Pluto’s shift is about 2132 km, which is Charon.

Masses and elements are the JPL SSD tables (JUP365, SAT441, URA111, NEP097, PLU060, and the mean-element page) at epoch 2000-01-01.5. The circles are a picture of where the planet sits relative to its barycenter. They are not moon orbits, and they are not DE440. Earth is left out of this rule. The snapshot already places Earth and the Moon about their barycenter.

The state carries `barycenter-circle` when this offset was added.

## Kernels

`kernels/sources.json` is the index: filename, NAIF URL, SHA-256, path, and role. `node scripts/fetch-kernels.mjs` downloads a missing file and checks the checksum. A file already on disk is kept when the checksum matches. A checksum that does not match stops the script. The wrong file is not overwritten.

| File | Where it lives | Role |
| --- | --- | --- |
| `de440.bsp` | `data/kernels/`, gitignored | Full planetary kernel. The page loads a cut of it. |
| `gm_de440.tpc` | `data/kernels/`, gitignored | Earth and Moon GM, copied into the manifest as a check. The page does not read this text kernel. |
| `pck00011.tpc` | `kernels/pck00011.tpc` | Radii and J2000 poles. The page imports this file. |

The page loads `public/ephemeris/de440-earth-moon-sun.bsp` when a neighbor, another segment center, or a Sun direction is needed. The file is 10,889,216 bytes. It is a cut of DE440, not a resample. Every source Chebyshev record whose interval overlaps the window is copied with its own degree, interval length, and first boundary. The companion JSON records the source URL, the source SHA-256, the output SHA-256, the Earth and Moon GM values, and the segment table.

The source kernel is `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp`, SHA-256 `a4ce9bf9b3282becc9f4b2ac3cebe03a2ae7599981aabd7265fd8482fff7c4b5`. The cut’s SHA-256 is `4925e6f126c79ec565b23281f9d7f571b6de2fe150239e7b9446ba65e55bae81`.

The requested window is 1950-01-01 through 2050-01-01, ephemeris time from −1,577,880,000 s to +1,577,880,000 s. Records are kept out to their native edges. Earth, the Moon, the Sun, and barycenters 1–3 run from −1,578,052,800 s to +1,577,966,400 s. Barycenters 4–9 are stored in 32-day records, so they start one interval earlier, at −1,579,435,200 s. Mercury and Venus are each one degree-1 record covering the whole span.

All fourteen segments are type 2 (Chebyshev position polynomials), NAIF frame 1, little-endian. Later segments in the file win when coverage overlaps. The order is the DE440 order.

| Target | Center | Record length | Degree | Records |
| --- | --- | --- | --- | --- |
| 1, Mercury barycenter | 0, solar-system barycenter | 8 days | 13 | 4566 |
| 2, Venus barycenter | 0, solar-system barycenter | 16 days | 9 | 2283 |
| 3, Earth–Moon barycenter | 0, solar-system barycenter | 16 days | 12 | 2283 |
| 4, Mars barycenter | 0, solar-system barycenter | 32 days | 10 | 1142 |
| 5, Jupiter barycenter | 0, solar-system barycenter | 32 days | 7 | 1142 |
| 6, Saturn barycenter | 0, solar-system barycenter | 32 days | 6 | 1142 |
| 7, Uranus barycenter | 0, solar-system barycenter | 32 days | 5 | 1142 |
| 8, Neptune barycenter | 0, solar-system barycenter | 32 days | 5 | 1142 |
| 9, Pluto barycenter | 0, solar-system barycenter | 32 days | 5 | 1142 |
| 10, Sun | 0, solar-system barycenter | 16 days | 10 | 2283 |
| 301, Moon | 3, Earth–Moon barycenter | 4 days | 12 | 9132 |
| 399, Earth | 3, Earth–Moon barycenter | 4 days | 12 | 9132 |
| 199, Mercury | 1, Mercury barycenter | the whole span | 1 | 1 |
| 299, Venus | 2, Venus barycenter | the whole span | 1 | 1 |

Ids 499, 599, 699, 799, 899, and 999 are absent from this cut. Those planets use the barycenter chain plus the offset above. Id 3 is the Earth–Moon barycenter. Id 399 is Earth. Id 5 is the Jupiter barycenter. Id 599 is Jupiter.

The GM check copied from `gm_de440.tpc` (SHA-256 `924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140`) is Earth 398,600.43550702266 km³/s², Moon 4,902.80011845755 km³/s², and their ratio 81.30056822149722. That ratio is a check against the native Earth segment. The state the page serves is the native segment.

To rebuild the snapshot from the kernels named in `kernels/sources.json`:

```sh
node scripts/fetch-kernels.mjs
CUT_DE440=1 npx vitest run tests/generate-snapshot.test.ts
```

`data/venv/bin/python scripts/cspice-fixtures.py` rewrites `tests/fixtures/de440-cspice.json` from the full `de440.bsp`. `data/venv/bin/python scripts/discrete-fixtures.py` rewrites the discrete-type fixture. The reduced SPK, its manifest, and the small fixtures are the files this tree publishes.

Same-kernel checks against CSPICE N0067, aberration `NONE`, bound the evaluator. On the Earth–Moon–Sun cases the tests ask for a position residual under 2×10⁻⁵ m and a velocity residual under 10⁻¹⁰ m/s. A more distant barycenter uses that position bound scaled by distance over 10⁸ km, because a Neptune-sized coordinate already sits on the millimeter step of ordinary floating point. On the separate type 8/9/12/13 fixture the bounds are 10⁻⁶ m and 10⁻⁹ m/s. The comparison is two readers of one kernel.

## Time

The scientific clock is a split TAI Julian Date, following the ERFA split-date conventions. An OEM sample’s `t` is TAI seconds from the file origin. The origin is the first UTC sample. Those seconds are not seconds past J2000, and they are not a JavaScript `Date`.

TT is TAI plus 32.184 s. SPICE ephemeris time is TDB seconds past JD 2451545.0, noon on 2000-01-01. The converter used here sets TDB equal to TT and records `tdb-equals-tt` on the state. Replacing `tdbSecondsPastJ2000` is the place to introduce a TDB−TT series. Callers already keep the quality flag.

Leap seconds come from the IERS `leap-seconds.list` bulletin retrieved 2026-11-11. The file expires 2027-06-28. TAI−UTC is 37 s from 2017-01-01. Instants after the expiry still use 37 s and are marked dubious. UTC before 1972-01-01 is rejected, because the modern integer table does not describe the rate-offset UTC of 1961–1971. A pre-1972 instant is shown as an em dash.

At 2000-01-01 12:00:00 UTC the leap table gives TAI−UTC = 32 s, so the TAI instant is 12:00:32 and TT sits 64.184 s after J2000 TT. Under the approximation above, that is the SPK argument. A file whose UTC is 2017-01-01 00:00:00 has TAI−UTC = 37 s, so TT−UTC is 69.184 s.

For a spacecraft SPK the file origin is chosen so that clock time zero is the kernel’s earliest ephemeris time, run backwards through the same 32.184 s. Adding 32.184 s on the way into the evaluator returns that ephemeris time.

## Frames

EME2000 is the dynamical mean equator and mean equinox of J2000.0. X points at that equinox, Z at that pole, and Y completes the right-handed set. An OEM segment whose `REF_FRAME` is `EME2000` is copied through.

OEM `GCRF` and OEM `ICRF` both mean the GCRS/ICRS axis set here. NAIF frame 1 on this DE440 kernel is that same ICRF set. The kernel’s frame name is `J2000`. The vectors are ICRF. A single stored rotation, the IAU 2006 frame bias frozen at J2000.0, takes those axes into EME2000. The off-diagonal terms are about 15, 17, and 7 milliarcseconds. The matrix lives in `src/core/frames.ts`. It was evaluated once from the ERFA Fukushima–Williams chain, so applying it does not rerun the nutation series. Because the bias is constant, velocity is rotated the same way as position.

OEM files meet that matrix only in `sourceToEme2000`. DE440 vectors meet it only when the caller asks for EME2000. Chebyshev evaluation itself returns the kernel axes.

Drawing a solar-system-barycentric ICRF vector and a geocentric GCRS vector on one set of axes is the picture convention. The page records that as `shared-inertial-axes`. It does not reduce BCRS to GCRS.

Right ascension and declination are the spherical angles of the center-relative EME2000 vector. They are geocentric only when the center is Earth. They are calculated and not plotted.

### Earth and Moon orientation

The Earth mesh uses one equinox formulation, in `src/core/ephemeris/orientation.ts`: IAU 2006 precession, the 77-term IAU 2000B nutation series with its small planetary offsets, and Greenwich apparent sidereal time for the crust. The older IAU 1982 sidereal polynomial is still in the code as `gmst` and is not the crust rotation. The CIO locator and a standalone Earth-rotation-angle orientation are unused.

No polar-motion bulletin is loaded, so the pole offset is omitted and reported as polar motion `unavailable`. It is not filled with a zero that would claim a measured pole. UT1 is the file’s UTC, so UT1 is `approximate`. A caller who supplies pole coordinates for that epoch can insert them before the sidereal rotation. The tiny TIO locator is omitted. It sits under the floor of the 2000B series.

The Moon uses the IAU working-group pole, prime meridian, and libration arguments. Body-fixed +X is the prime meridian and +Z is the north pole, and the matrix sends that into EME2000. This is the cartographic series. It is not read from the PCK. The lunar radius is the separate PCK value in the table above.

Until the snapshot has loaded, the terminator uses a low-precision geocentric Sun direction, good to about 0.01°. After that, the Sun direction is the geometric DE440 state of the Sun relative to the lit body. For Jupiter that chain runs through the Jupiter barycenter and then the circle-rule offset. For the Moon the direction is geocentric, so the terminator differs from a Moon-centered Sun by a fraction of a degree.

A spacecraft body frame is reserved and unused. `attitudeAt` returns null. The marker is a screen-space point. Velocity supplied to the follow camera is a camera offset.

## OEM and SPK support

OEM 2.0 and 3.0, KVN or XML, one object, any number of segments. The format is detected from the contents after a byte-order mark and leading whitespace. The extension is only a picker hint. Files larger than 50 MB are rejected. Header fields that are preserved: version, creation date, originator, message id, comments, and per segment the object, center, frame, epoch, time system, start and stop, usable window, and interpolation. Covariance is kept and not drawn. Comments are shown as text.

State rows are epoch, position, velocity, and optional acceleration. KVN units are km, km/s, and km/s². XML units are checked when present. Stored values are meters. Samples outside the usable window remain available as interpolation support and are not part of the drawn arc.

A segment is evaluated when all of the following hold:

- the time system is UTC
- the center name is in the SANA orbit-center subset
- the reference frame is EME2000, GCRF, or ICRF
- the interpolation method is one this viewer implements

Anything else still opens in the inspector. A view that needs the missing transform says why.

The center list is a subset of the SANA Orbit Centers registry (`https://sanaregistry.org/r/orbit_centers/`, updated 2023-05-17). Matching ignores case, repeated spaces, and parentheses around a leading catalog number: Earth, the Moon, the Earth barycenter, Earth–Moon L1 and L2, the Sun and the planets through Pluto together with their barycenters, the solar-system barycenter, Sun–Earth L1 and L2, and the named small bodies in `src/core/centers.ts`. The clock follows the segment that covers the epoch and draws that center. Other segments are drawn when their centers can be placed.

Interpolation, in `src/core/interpolate.ts`:

| Declaration | What is evaluated |
| --- | --- |
| Method and degree both omitted | Two-node cubic Hermite, labeled **Viewer default — cubic Hermite** |
| `LINEAR`, degree omitted or 1 | Independent linear series for position and for velocity |
| `LAGRANGE`, integer degree 1 through 12 | Barycentric Lagrange. Velocity is its own series on the velocity samples |
| `HERMITE`, degree 3, 5, 7, 9, or 11 | Position and velocity together. Degree 3 is the closed cubic. Higher odd degrees use a Newton form on repeated nodes |

An exact sample epoch returns the stored state. There is no extrapolation and no SGP4. Overlapping usable windows are not merged. The segment already in view stays while it still covers the epoch. Otherwise the clock uses the covering segment that started latest. A shared boundary that carries two states is a discontinuity.

For a Lagrange segment, position and velocity are interpolated separately. Differentiating the position polynomial is not how the velocity is obtained. A Hermite segment does use the derivative of the position polynomial.

### SPK types

A local file whose first bytes are `DAF/SPK` is read in the browser, under the same 50 MB cap. The reader accepts little-endian `LTL-IEEE` files. A summary is five double words: target, center, frame, type, initial address, final address, and the coverage endpoints in TDB seconds past J2000.

Supported data types, and only in NAIF frame 1:

| Type | Contents | Position | Velocity |
| --- | --- | --- | --- |
| 2 | Chebyshev position polynomials, equal intervals | The polynomial | Its time derivative |
| 3 | Chebyshev position and velocity polynomials | The position polynomial | The stored velocity polynomial |
| 8 | Equally spaced Cartesian states | Lagrange on each component | Lagrange on the stored velocity |
| 9 | Unequally spaced Cartesian states | same | same |
| 12 | Equally spaced states, Hermite | Newton form on position and velocity | Derivative of that polynomial |
| 13 | Unequally spaced states, Hermite | same | same |

Kernels are searched latest first, and segments inside a kernel are searched latest first. Coverage is closed. The first covering segment in that order is the one that is used. If its type or frame is unsupported, evaluation fails. An older segment is not substituted. A time that misses every segment is `outside-coverage` or `gap`, and those gaps are not bridged by a drawn line.

For types 8 and 9 the Lagrange window is the one in the SPK required reading. An even window places the request between the two central states. Near either end the window is clamped so that it still contains a full set of states. An exact state epoch belongs to the later window. Types 12 and 13 store the window size, and the Hermite degree is twice that window, minus one.

Changing center is vector subtraction in one inertial frame. If the selected segment’s center is already the requested center, that segment is evaluated and the walk stops. A spacecraft kernel written relative to Earth (NAIF 399) therefore works with no planetary kernel present. Otherwise each body is walked to the solar-system barycenter (id 0, the zero vector) and the two barycentric states are subtracted. A repeated body in that walk is `unresolved-center`.

An SPK opened as a trajectory reuses the segment list and the clock. Its sample list is empty and its interpolation plan is unsupported, so the OEM interpolator cannot invent states. Playback calls the SPK evaluator.

## Pipeline

Everything the user opens is local. The page reads an `ArrayBuffer` or decodes OEM text in the browser. File contents are not posted to a server. The sample button requests only a file that was bundled with the page. The planetary snapshot is fetched from the same origin as a static file.

1. **Identify the file.** After the 50 MB check, the leading bytes `DAF/SPK` select the SPK path. Anything else is decoded as OEM text.
2. **Parse off the main thread.** A worker reads the OEM into samples, or reads the SPK summaries into a trajectory shell. The shell carries coverage, center, frame, and interpolation metadata. Its sample list is empty.
3. **Bind the kernel.** The worker cannot return a usable buffer alias, so the main thread keeps the SPK bytes and attaches them to the parsed object. Evaluation reads those bytes.
4. **Advance a TAI clock.** Playback time is TAI seconds from the file origin. Display epochs are formatted from the split Julian Date.
5. **Evaluate.** OEM playback calls the OEM interpolator, then `sourceToEme2000` when the segment is GCRF or ICRF. SPK playback converts the clock instant to ephemeris time, selects the window, evaluates, converts to meters once, and applies the frame bias once when EME2000 was requested.
6. **Place the scene.** Arc vertices stay center-relative EME2000 meters. At draw time the segment center is placed relative to the viewing center, the vertex is added, and `toScene` runs once. Neighbors use the same `place` step. A failure hides that body or arc for the frame and is recorded. The group is created hidden so a body does not appear at the origin while the kernel loads.
7. **Light and orient.** The Sun direction comes from the snapshot when the lit body is not the Sun. Otherwise the analytic direction is used. Earth orientation uses the file UTC as UT1. The Moon uses its libration series on TT.

Float64 is the working type for states, coefficients, and time. The scene then scales meters to kilometers. At solar-system distances that floating-point step is on the order of 10 km. Near Earth it is a fraction of a meter. Both are acceptable for drawing.

## Materials

### Stars

Stars are the Extended Hipparcos Compilation (XHIP; Anderson & Francis 2012, *Astronomy Letters* 38, 331) cut at visual magnitude 6, as packaged for ofrohn/d3-celestial and stored in `public/skymap.json`. Each star is placed from its catalogue right ascension and declination on the EME2000 axes, then mapped into the scene the same way as a trajectory. Proper motion, parallax, annual aberration, and the ICRS frame bias are left out. At the scale of these point sprites the bias is far below a pixel. The stars are a backdrop.

Color is a B−V lookup on the d3-celestial red-to-blue ramp, then mixed halfway back toward white so the screen saturation is half of that ramp. A missing B−V stays white. Brighter stars are drawn larger, with a floor so the faintest ones remain a small point.

### Body maps

Equirectangular maps of Earth and the Moon have the date line at the left and right edges and longitude 0° at the center. The mesh local +X is that prime meridian and local +Y is north, before the EME2000 rotation. Jupiter uses the same mesh placement. Its map is not tied to an IAU prime meridian.

| Map | File | What it is |
| --- | --- | --- |
| Earth day, night, clouds | `public/textures/earth-day.jpg`, `earth-night.jpg`, `earth-cloud-day.jpg` | Equirectangular maps already in the repository. Their image metadata does not name a public source, so this document does not assign one. |
| Moon | `public/textures/moon.jpg` | NASA Scientific Visualization Studio CGI Moon Kit color map, a work of the United States Government, centered on 0° longitude. The crust rotation is the IAU series above. |
| Jupiter | `public/textures/jupiter.jpg` | Equirectangular color map, 2048×1024. The image metadata does not name a public source, so this document does not assign one. The realistic view uses it whether Jupiter is the center or a neighbor. The top of the map is mesh +Y. No Jupiter pole or prime-meridian series is applied, so that axis stays aligned with the EME2000 pole and the map does not rotate. |
| Sun | none | Untextured sphere of the PCK equatorial radius, 695,700 km. |
| Minimal style | none | Gray sphere, `#3a3a3c`, for the Moon and the planets when the realistic maps are off. The Sun stays the Sun. |
| Lens flare | shader in `src/view/SunFlare.tsx` | CC0 shader from ektogamat/R3F-Ultimate-Lens-Flare. In the realistic view it follows the Sun disk, at the origin or in orbit. Neighbor bodies occlude it. |

Earth and the Moon are the bodies that spin. Jupiter has a map, and that map stays fixed to the pole.

## Technology and licenses

The application is MIT, copyright 2026 Spaceth.co, in `LICENSE`.

Runtime libraries, from the `license` field of the installed packages:

| Package | License |
| --- | --- |
| React 19, React DOM | MIT |
| Three.js | MIT |
| React Three Fiber, Drei, `@react-three/postprocessing`, maath | MIT |
| `postprocessing` | Zlib |
| Vite | MIT |
| TypeScript (build) | Apache-2.0 |
| Vitest (tests) | MIT |
| Poppins, via Fontsource | SIL Open Font License 1.1 |

Thai glyphs come from Aktiv Grotesk Thai in the Adobe Fonts kit `ayj4ilb`. That kit is requested from Adobe when the page loads and remains under the Adobe Fonts terms. It is not a file in this repository.

Scientific series that are not covered by the MIT grant alone:

- The 77 nutation amplitudes in `src/core/ephemeris/nutation2000b.ts`, and the complementary equinox terms used with them, are the ERFA transcription of the SOFA series. The file header carries the NumFOCUS copyright (2013–2023) and the statement that the work is derived, with permission, from SOFA. Those notices stay with the numbers.
- DE440 and `gm_de440.tpc` are NAIF generic kernels from the JPL server named in the manifest. The repository publishes the trimmed SPK and the constants in the companion JSON, identified by the SHA-256 values above.
- The leap-second table is the IERS Bulletin C list named in `src/core/time.ts`.
- XHIP positions are used as packaged by d3-celestial. The citation is Anderson & Francis 2012.
- The lunar color map is a NASA SVS product, a United States Government work.
- CSPICE N0067, through spiceypy, is the validation reader. It is installed in the gitignored `data/` environment and is not a runtime dependency.

Interpolation tests use analytic polynomials. The 2016-12-31 leap second is checked on the TAI scale. `public/sample/EM2.oem` is the NASA/JSC EM-2 ephemeris included with this repository (EME2000, UTC, April 2026). It is a sample trajectory. The other examples in that directory are the files the page offers: ISS, DART, CE7, LRO, and Juno.
