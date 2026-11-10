# Cursor Agent prompt — build ephemeris.spaceth.co

Implement **ephemeris.spaceth.co**, a browser-based viewer for a user's local CCSDS Orbit Ephemeris Message (OEM). The intended users include Thai space mission teams, observatories, and people following their missions. A user opens one file, explores the spacecraft trajectory in 3D, and sees where it would be in the sky from a selected location on Earth. Implement and verify the app in this repository. A plan alone is insufficient.

## 1. Read the repository and design rules first

1. Locate and read **`design.md` in full before making UI or styling decisions**. Also read applicable `AGENTS.md`, the README, package configuration, and existing source. Treat `design.md` as the visual and interaction authority. Reuse the repository's components, fonts, colors, spacing, layout, and naming conventions. If `design.md` is absent, report the missing file and proceed with a neutral, accessible layout. Preserve any existing design work.
2. Keep the existing build system and package manager. In an empty repository, use Vite, React, TypeScript, Three.js, and React Three Fiber. Use version-compatible Three/R3F dependencies. Keep the app deployable as static assets.
3. Keep this a local-file viewer. Use the browser file picker and drag-and-drop. The OEM, filename, parsed trajectory, and observer coordinates stay in browser memory. The viewer needs no accounts, backend, mission catalogue, file persistence, uploads, or remote ephemeris requests. Bundle the reference data used by the app as static assets. Use a small, clearly labeled local sample so a user can try the viewer without finding a file first.

## 2. Implement the user flow

- **Open and inspect** — Accept CCSDS OEM KVN text and OEM XML. Detect format from content after stripping a BOM and leading whitespace. The file extension is a picker hint. Show object name/ID, originator, creation date, source time system, segment count, centers/frames, usable coverage, and any fallback or validation warning. Provide a compact table of state samples for the selected segment, with source epoch and units.
- **Orbit View** — Draw the Earth and the trajectory, place a marker at the evaluated state, and allow camera orbit, zoom, and reset. Show the selected station on the globe when its Earth orientation is available. A 3D inertial view is the default. Keep ground-fixed objects oriented at the current epoch. Draw the trajectory as separate arcs per segment, with no closing edge, bridge across gaps, or smoothed path from a rendering spline.
- **Observer View** — Let the user enter latitude, longitude, and ellipsoidal height. Include at least one sourced Thai observatory preset if authoritative coordinates and the height reference can be verified. Otherwise use manual entry and label the sample station clearly. Draw a polar sky plot with zenith at the center, horizon at the outer rim, north at the top, east on the right, and ticks for elevation and azimuth. Show geometric Az/El, topocentric geometric RA/Dec in a named frame, and slant range. Show the target marker at the same epoch as the 3D view. Below-horizon samples should be labeled and kept out of the visible sky track. Elevation above a threshold describes geometric access. Optical visibility also depends on illumination and observing conditions.
- **Timeline** — Use a single simulation clock for both views. Provide play/pause, scrub, speed control, and an absolute UTC readout when convertible. Display coverage boundaries and gaps. While scrubbing through a gap or beyond coverage, hide the spacecraft marker and return a clear unavailable state. For observer access, allow an elevation threshold and show rise, peak, and set where the file covers them. Mark passes clipped by coverage as partial.
- **Recovery and accessibility** — Handle empty, loading, invalid, unsupported, and no-WebGL states. An unsupported transform should preserve the file inspector and any view that can still be computed. A new file should replace the old one atomically after successful parsing. Support keyboard file selection and playback controls, readable contrast, and useful text equivalents for numerical data shown on the canvas. Keep the layout usable on mobile.

## 3. OEM standards and parser

Use **CCSDS 502.0-B-3 Orbit Data Messages**, Section 5 for OEM semantics and Section 7 for KVN syntax, and **CCSDS 505.0-B-3 XML Specification for Navigation Data Messages** for XML. Consult the corrigenda and SANA registry where referenced. Document the supported profile precisely. A valid file outside the calculation profile should be reported as unsupported for the relevant view.

- Support the common OEM 2.0 and 3.0 KVN and XML forms. Accept one OEM object per load, with multiple segments. Map both encodings to the same internal structure. Use a state machine for KVN header, metadata, state rows, and covariance blocks. For XML, use a namespace-aware parser with DTDs and external entities disabled. Keep the application network-independent when parsing. Validate expected structure and units against the appropriate specification. Parse comments as text and never insert their contents as HTML.
- Preserve `CCSDS_OEM_VERS` or the XML version, `CREATION_DATE`, `ORIGINATOR`, `MESSAGE_ID` when present, comments, and segment metadata including `OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME`, `REF_FRAME`, `REF_FRAME_EPOCH`, `TIME_SYSTEM`, `START_TIME`, `STOP_TIME`, `USEABLE_START_TIME`, `USEABLE_STOP_TIME`, `INTERPOLATION`, and `INTERPOLATION_DEGREE`. Retain covariance as source data if parsed, or identify it as unused. Keep it out of trajectory rows and skip uncertainty visualization for this version.
- Parse state rows as epoch, position, velocity, and optional acceleration according to the supported version. For KVN use the standard units of km, km/s, and km/s². For XML follow the schema and validate any explicit units. Convert to one internal convention, preferably SI, exactly once. Reject non-finite numbers, malformed state rows, conflicting or duplicate fields, non-increasing epochs inside a segment, and inconsistent bounds. Provide line numbers for KVN or element context for XML.
- Keep source samples outside the usable window when they are valid interpolation support points. Expose only the intersection of the usable interval (or the total interval when usable endpoints are absent) and sampled coverage. Evaluate one segment at a time. Treat a shared boundary with distinct states as a discontinuity. Define and test a deterministic endpoint rule, and require explicit segment selection for ambiguous overlapping usable windows. Do not silently sort or merge away defects.
- Support Earth-centered `EME2000` and `GCRF` with documented transforms. Add another frame only if it is required by a verified fixture and independently tested. Keep center, frame, and epoch as separate fields. Unsupported centers and frames remain inspectable. A future Moon-centered adapter must translate origins with an Earth–Moon ephemeris and rotate any body-fixed frame with an appropriate orientation model. Keep that provider out of the initial build.

## 4. Mathematical implementation

Keep the following logic in a testable TypeScript core, separate from React, Three.js, and the renderer's coordinate system. Provide equivalents of `parseOem(file)`, `stateAt(epoch, segment?)`, `observeAt(epoch, station)`, and `findPasses(window, station, minElevation)`. Use explicit units and typed results for unavailable states. Use Float64 for scientific calculations.

### Epochs and time scales

- Support UTC input for the first release. Parse CCSDS calendar and day-of-year forms where allowed by the standard, including fractional seconds. Read the segment's `TIME_SYSTEM`; timestamp text alone does not establish the time scale. Keep the original epoch string for display. Unsupported time systems can be inspected without enabling calculations that depend on them.
- Use a continuous time representation for interpolation and playback, for example a split epoch plus elapsed TAI seconds relative to a nearby reference. Use an authoritative, versioned leap-second table for UTC/TAI and validate leap-second input. Do not use JavaScript `Date` or POSIX milliseconds as the scientific epoch representation. Use `TT = TAI + 32.184 s`. Derive UT1 from UTC and IERS DUT1 using a time-scale implementation that handles leap-second boundaries. Pass split Julian Dates to the Earth-orientation routines. Make reference-data validity and source coverage visible. Future support for TDB requires an explicit conversion.

### Interpolation of Cartesian states

- OEM supplies sampled states. Evaluate them by interpolation over covered intervals. Keep extrapolation and SGP4 outside this workflow. Binary-search for the relevant segment and local sample window. Use time offsets relative to a nearby sample and scale time before evaluating polynomials. Return original states at exact sample epochs.
- Honor a declared interpolation method and degree when supported. Implement **Lagrange** with a stable local barycentric evaluator and `degree + 1` distinct nodes. Specify whether velocity is interpolated as a separate series and apply that choice consistently in the tests. Implement **Hermite** with position/velocity constraints and a degree-matched local window. With position and first derivatives at each node, `n` nodes define a polynomial of degree at most `2n − 1`. Only accept degrees and derivative combinations actually implemented. Support explicit linear interpolation where compatible with the profile. Report an unsupported method/degree or insufficient samples instead of silently substituting one.
- For two-node cubic Hermite, let `h = t1 − t0` in seconds and `u = (t − t0)/h`. Evaluate each Cartesian component using:

  ```text
  p(u) = (2u³ − 3u² + 1)p0 + (u³ − 2u² + u)h v0
       + (−2u³ + 3u²)p1    + (u³ − u²)h v1
  v(u) = (dp/du) / h
  ```

- If the producer omitted interpolation guidance, use two-node cubic Hermite where positions and velocities exist and label it **Viewer default — cubic Hermite**. This is an application policy. Do not infer gaps from a universal cadence. Use explicit segment and usable boundaries, and flag unusually sparse data if a clearly documented display heuristic is added.

### Earth orientation and reference frames

- Use the **IERS Conventions (2010), Chapter 5**, with a validated IAU SOFA/ERFA implementation or binding for Earth attitude. Define `C(t)` as the matrix that maps GCRS-aligned geocentric axes to ITRS at epoch `t`, using column vectors. The conceptual chain is celestial-pole orientation and precession/nutation, Earth rotation using UT1, and polar motion. `C(t)^T` maps in the reverse direction. Use a documented EME2000-to-GCRF frame bias when that source frame is selected.
- Prefer SOFA/ERFA `c2t06a` for the model using TT, UT1, and polar motion. If using observed celestial pole offsets `dX,dY`, use the appropriate corrected CIO chain and document it. Use IERS EOP values within their published coverage, with units converted correctly. Identify the data and distinguish measured and predicted coverage where supplied. If EOP is unavailable, leave observer and Earth-fixed results unavailable by default. An explicitly labeled approximate preview may use documented assumptions such as DUT1 and polar motion set to zero. Never use an unlabeled fallback. Keep the inertial trajectory available when its own frame and epochs are supported.
- For vectors in a rotating frame, position and velocity transforms differ. If implementing transformed velocity, include the derivative term, `v_fixed = C v_inertial + dC/dt · r_inertial`. This version can limit velocity display to the source state and omit range rate.

### Topocentric geometry

Use WGS84 geodetic latitude `φ`, east-positive longitude `λ`, and ellipsoidal height `h` in meters. Height above mean sea level needs a geoid conversion or a clearly documented input assumption.

```text
a = 6378137 m
f = 1 / 298.257223563
e² = f(2 − f)
N = a / sqrt(1 − e² sin²φ)
r_station_fixed = ((N+h)cosφcosλ, (N+h)cosφsinλ, (N(1−e²)+h)sinφ)

d = C(t) r_target_gcrs − r_station_fixed
E = (−sinλ,             cosλ,            0) · d
N_local = (−sinφcosλ, −sinφsinλ,       cosφ) · d
U = ( cosφcosλ,  cosφsinλ,       sinφ) · d

Az = wrap_0_2π(atan2(E, N_local))
El = atan2(U, hypot(E, N_local))
range = hypot(E, N_local, U)

d_gcrs = C(t)^T d = (x,y,z)
RA  = wrap_0_2π(atan2(y,x))
Dec = atan2(z, hypot(x,y))
```

Use radians internally. Display Az/El and Dec in degrees and RA in hours, with an optional degree readout. Treat azimuth at zenith/nadir, RA on the celestial pole, and zero-range direction as undefined where appropriate. Label RA/Dec as **topocentric geometric, GCRF axes**. Use the observer's position at the same epoch for V1. The displayed angles are geometric and airless. Apparent angles, light-time, stellar aberration, and refraction are outside this release. Keep these definitions visible so values can be compared like for like with other tools.

### Pass finding

Search each usable segment independently. Sample `f(t) = El(t) − minElevation` with a documented scan step chosen for the shortest pass the app is intended to resolve. Use adaptive subdivision or check for local peaks to catch short or grazing passes near the threshold. Bracket crossings and refine them with bisection or Brent. Find peak elevation within each pass using bounded refinement over candidate local maxima. Mark passes already in progress at a coverage boundary as partial. Keep the algorithm independent of animation FPS and disclose any resolution limit rather than claiming every grazing event can be found.

## 5. Rendering and browser implementation

- Keep scientific vectors in the core's coordinate system. Apply one explicit, tested transform into the scene, for example `(X,Y,Z) → (X,Z,−Y)` if the renderer uses Y-up. Apply the same convention to Earth orientation and station positions. Use `C^T` to orient Earth-fixed geometry in an inertial scene, including the documented longitude zero of the texture. Keep Earth dimensions and rendered trajectory units consistent.
- Build one reusable `BufferGeometry` per displayed arc. Use sampling or decimation for display only, preserving segment edges. Evaluate the live marker from `stateAt`. Keep Float64 source data and convert scaled, local coordinates to Float32 only for GPU buffers. Use `useFrame` with refs for fast updates. Put heavy parsing, pass scans, and trajectory buffer generation in a Worker where supported by the existing stack. Cap accepted file size and provide a readable error. Ensure stale results from a previous file or station cannot overwrite the current view.
- Use an SVG or Canvas sky plot according to `design.md`. A simple horizon projection uses `ρ = R(1 − El/(π/2))`, `x = cx + ρ sin Az`, `y = cy − ρ cos Az` for `0 ≤ El ≤ π/2`. For a configurable minimum elevation, show the threshold separately from the horizon. Clip the rendered track at refined crossings and preserve segment breaks.
- Use text for actionable warnings and accessible values, and keep the time controls responsive while processing. Use bundled assets and avoid telemetry that could transmit local file or station data.

## 6. Verification and handoff

1. **Parser fixtures** — Equivalent KVN and XML, multiple segments, comments/covariance, optional acceleration, missing/unsupported interpolation, bad units or non-finite values, gaps and overlap, and invalid or unsupported epochs/frames. Test both calendar and ordinal UTC dates and at least one known UTC leap-second boundary.
2. **Math fixtures** — Exact endpoint recovery, analytic polynomial interpolation, no interpolation across a maneuver boundary, WGS84 station checks, east/north/overhead targets, RA wrap, and the scene-axis transform. Use a known SOFA/ERFA terrestrial rotation example. Freeze the EOP and leap-second inputs for reproducible results.
3. **Independent reference** — Use a small public sample such as NASA's ISS OEM, or a mission fixture explicitly authorized for repository use. For reproducible tests, pin the fixture revision or use an independently generated fixture with documented provenance. Compare states with an independent evaluator using the same interpolation convention. Compare observer angles and pass timing with Orekit or another independent reference at fixed epochs and a fixed station, matching units, datum, time scales, and EOP. For optional Horizons comparisons, align trajectory source, observer, coordinate frame and corrections. A Horizons apparent observer table is not the oracle for this geometric mode. Document tolerances and measured differences for the chosen data profile. Do not claim pointing accuracy beyond what the checks establish.
4. **End-to-end smoke test** — Load a file via the actual browser picker, change station, scrub/play, and confirm both views and their time readout agree. Try a gap, an unsupported file, no EOP coverage, and a narrow screen. Confirm in browser network inspection that opening an OEM generates no upload or remote data request.
5. Run the repo's lint, type-check, tests, and production build. Add concise README instructions for running the app, supported OEM features and limitations, coordinate conventions, data coverage, and updating reference assets. In the handoff list what ran, what failed or could not be checked, and the supported import profile. Keep deployment changes out of this task.

## References to consult while implementing

- [CCSDS 502.0-B-3 — Orbit Data Messages and current corrigenda](https://ccsds.org/publications/allpubs/entry/3073/)
- [CCSDS 505.0-B-3 — XML Specification for Navigation Data Messages](https://ccsds.org/Pubs/505x0b3e2.pdf)
- [IERS Conventions Centre — Chapter 5, ITRS and GCRS](https://iers-conventions.obspm.fr/chapter5.php)
- [IAU SOFA — Earth Attitude and time-scale cookbooks](https://www.iausofa.org/cookbooks)
- [IERS Bulletins — Earth Orientation Parameters and leap seconds](https://data.iers.org/bulletins.php)
- [Orekit — Reference frames and topocentric calculations](https://test.orekit.org/site-orekit-13.0/architecture/frames.html)
- [JPL Horizons Manual — Observer quantities and correction conventions](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [NASA ISS — public OEM sample feed](https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt)
- [React Three Fiber — Performance pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls)
- [Three.js — BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
