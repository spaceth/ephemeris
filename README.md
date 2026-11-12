# Ephemeris

A static viewer for one spacecraft trajectory and the Earth, Moon, and Sun around it. Open a local CCSDS Orbit Ephemeris Message or a NAIF SPK. The file stays in the browser. The scene origin is the center named by the segment on screen. Positions are geometric: there is no light-time, stellar aberration, refraction, or apparent-place reduction.

```sh
npm install
npm run dev
```

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are the checks. The build writes static files to `dist/`. Bundled OEM samples live in `public/sample/`.

## 1. Overview

The viewer has two evaluators, and they do not stand in for each other.

An OEM is a table of Cartesian states. Between samples the viewer builds the interpolant declared in the segment: linear, Lagrange, or Hermite. The result is a position and a velocity in meters, on the file’s time scale, in the file’s inertial frame, relative to the named center.

An SPK is a DAF of Chebyshev or discrete-state segments. The evaluator reads the native coefficients or states, selects the SPK window, and returns a `CartesianState`: target and center as NAIF ids, frame, position in meters, velocity in meters per second, epoch, coverage, and a quality list. Kilometers stored in the kernel become meters once, at that boundary.

The application clock is file-relative TAI seconds. It is not seconds past J2000, and it is not a JavaScript `Date`. SPK evaluation uses a separate argument, TDB seconds past J2000 (SPICE ephemeris time). The conversion used here sets TDB equal to TT and records that choice on the state.

The canonical inertial axes are EME2000, the dynamical mean equator and equinox of J2000.0. The picture is a Y-up scene in kilometers. The only map from a science vector \(\mathbf{r}\) in meters to the scene is

\[
(X, Y, Z)\;\mapsto\;(X,\; Z,\; -Y)\times 10^{-3}
\]

applied after the origin has been subtracted. That map does not rotate the frame again.

Same-kernel checks against CSPICE N0067, aberration `NONE`, bound the evaluator. On the committed Earth–Moon–Sun snapshot the tests require a position residual below \(2\times 10^{-5}\,\mathrm{m}\) and a velocity residual below \(10^{-10}\,\mathrm{m\,s^{-1}}\). On the type 8/9/12/13 fixture the bounds are \(10^{-6}\,\mathrm{m}\) and \(10^{-9}\,\mathrm{m\,s^{-1}}\). Those tests compare two readers of one kernel. They are not a Horizons comparison and they are not a pointing budget.

Three approximations are carried explicitly on the state or on the attitude result:

| Source | What is done | Status |
| --- | --- | --- |
| Time | \(\mathrm{TDB}=\mathrm{TT}\) | `approximate`, reason `tdb-equals-tt` |
| Axes | A barycentric ICRF vector and a geocentric GCRS vector share axis directions | visualization convention, not a BCRS-to-GCRS reduction |
| Earth rotation | UT1 is the file UTC; no polar-motion bulletin is loaded | UT1 `approximate`, polar motion `unavailable` |

A spacecraft body frame is reserved and unused. The marker is a screen-space point. Velocity supplied to the follow camera is a camera offset.

## 2. Reference frames

### EME2000

EME2000 is the dynamical mean equator and mean equinox of J2000.0. The \(X\) axis points at that equinox, \(Z\) at that pole, and \(Y\) completes the right-handed triad. An OEM segment whose `REF_FRAME` is `EME2000` is already in these axes. Its vectors are copied through.

Right ascension and declination are the spherical angles of the center-relative EME2000 vector:

\[
\alpha = \operatorname{atan2}(Y, X), \qquad
\delta = \operatorname{atan2}\!\left(Z, \sqrt{X^2+Y^2}\right)
\]

with \(\alpha\) wrapped into \([0, 2\pi)\). They are geocentric only when the center is Earth. \(\alpha\) is left undefined at the origin and on the pole, where the cylindrical radius is below \(10^{-8}\) of the range (or the range itself is below \(10^{-3}\,\mathrm{m}\)). They are calculated and not plotted. There is no light-time or aberration in them.

**Example.** \(\mathbf{r} = (1, 1, 0)\) has \(\alpha = 45^\circ\) and \(\delta = 0^\circ\). \(\mathbf{r} = (0, 0, 1)\) has \(\delta = +90^\circ\) and no right ascension. One Earth radius along the equinox, \(\mathbf{r} = (6\,378\,137,\, 0,\, 0)\,\mathrm{m}\), is the scene point \((6378.137,\, 0,\, 0)\,\mathrm{km}\). The same length along EME2000 \(Y\) is the scene point \((0,\, 0,\, -6378.137)\,\mathrm{km}\).

### GCRS, GCRF, ICRF, and the frame bias

OEM `GCRF` and OEM `ICRF` both name the GCRS/ICRS axis set in this profile. NAIF frame id 1 on the DE440 kernel used here is that same ICRF axis set. The kernel’s frame name is `J2000`; the vectors are not dynamical EME2000.

The IAU 2006 frame bias, frozen at J2000.0 and stored row-major in `src/core/frames.ts`, takes a GCRS column vector into EME2000:

\[
\begin{aligned}
R_{00} &= 0.9999999999999941158, &
R_{01} &= -7.078368960971556128\times 10^{-8}, &
R_{02} &= 8.056213977613186084\times 10^{-8},\\
R_{10} &= 7.078368694637676268\times 10^{-8}, &
R_{11} &= 0.9999999999999968914, &
R_{12} &= 3.305943735432137487\times 10^{-8},\\
R_{20} &= -8.056214211620057482\times 10^{-8}, &
R_{21} &= -3.305943169218394928\times 10^{-8}, &
R_{22} &= 0.9999999999999962252.
\end{aligned}
\]

The off-diagonal elements are \(14.6\), \(16.6\), and \(6.8\,\mathrm{mas}\), the size of the IAU 2006 bias \((\mathrm{d}\alpha_0, \xi_0, \eta_0)\). The matrix was evaluated from the ERFA Fukushima–Williams chain and stored, so applying it does not require the nutation series. It is a rotation, so the inverse is the transpose. A round trip is tested.

OEM files meet this matrix only in `sourceToEme2000`. DE440 vectors meet it only when the caller asks for EME2000, in `icrfToEme2000` / `rotateState`. Chebyshev evaluation returns the kernel axes. Because the bias is constant, its rate is the zero matrix and the velocity transforms as \(\mathbf{v}' = R\mathbf{v}\). A time-dependent rotation would add \((\mathrm{d}R/\mathrm{d}t)\,\mathbf{r}\).

Treating a solar-system-barycentric ICRF vector and a geocentric GCRS vector as one axis set is the drawing convention. It is not a relativistic transformation from the BCRS to the GCRS.

### ITRF and the equinox chain

The Earth mesh is oriented by one equinox formulation, in `src/core/ephemeris/orientation.ts`:

1. IAU 2006 precession in the Fukushima–Williams four angles \((\gamma, \phi, \psi, \epsilon_A)\).
2. IAU 2000B nutation, the 77-term luni-solar series of McCarthy & Luzum / Luzum (2001), plus the planetary offsets \(\Delta\psi_\mathrm{plan} = -0.135\,\mathrm{mas}\) and \(\Delta\epsilon_\mathrm{plan} = +0.388\,\mathrm{mas}\).
3. Greenwich apparent sidereal time, which is the crust rotation.

The celestial matrix, from the mean equator of J2000 toward the true equator of date, is

\[
N\,P\,B = R_1\!\big(-(\epsilon_A+\Delta\epsilon)\big)\,
R_3\!\big(-(\psi+\Delta\psi)\big)\,
R_1(\phi)\,
R_3(\gamma).
\]

Greenwich mean sidereal time is the IAU 2006 series: the Earth rotation angle plus the published precession polynomial in Terrestrial Time. The angle that multiplies the crust is Greenwich apparent sidereal time,

\[
\mathrm{GST} = \mathrm{GMST}_{06} + \Delta\psi\cos\epsilon_A + E_{\mathrm{ect}},
\]

where \(E_{\mathrm{ect}}\) is the complementary equation-of-the-equinoxes series (ERFA `eect00`). The CIO locator and a standalone Earth-rotation-angle orientation are not used. The older IAU 1982 GMST polynomial is still implemented as `gmst` and is not the crust rotation.

With no polar motion,

\[
\mathbf{v}_{\mathrm{true}} = R_3(-\mathrm{GST})\,\mathbf{v}_{\mathrm{ITRF}}, \qquad
\mathbf{v}_{\mathrm{GCRS}} = (NPB)^{\mathsf T}\mathbf{v}_{\mathrm{true}}, \qquad
\mathbf{v}_{\mathrm{EME2000}} = R\,\mathbf{v}_{\mathrm{GCRS}}.
\]

A caller who supplies pole coordinates \((x_p, y_p)\) for that epoch inserts \(W = R_2(-x_p)\,R_1(-y_p)\) before the sidereal rotation. The TIO locator \(s'\) is omitted; it sits under the milliarcsecond floor of the 2000B series. With no bulletin, \(W\) is omitted. It is not replaced by a zero matrix that would claim a measured pole. The returned status is then polar motion `unavailable`, UT1 `approximate`, and `bulletin: null`. UT1 is approximate because the argument is the file’s UTC: \(\mathrm{UT1}-\mathrm{UTC}\) is not observed. No Earth-orientation parameter series for 1950–2050 is bundled, and none is claimed.

**Example, J2000.0, compared with ERFA to 12 decimal places in the test.** At JD 2451545.0, with UT1 and TT both placed on that Julian Date:

| Quantity | Value |
| --- | --- |
| Mean obliquity, IAU 2006 | \(84381.406'' = 23.43927944^\circ\) |
| \(\Delta\psi\) | \(-6.7542612539922347\times 10^{-5}\,\mathrm{rad} = -13.9317''\) |
| \(\Delta\epsilon\) | \(-2.7970923310985653\times 10^{-5}\,\mathrm{rad} = -5.7694''\) |
| GMST | \(4.8949612831508285\,\mathrm{rad} = 18.69737\,\mathrm{h}\) |
| GST | \(4.8948993242232284\,\mathrm{rad}\) |

One Julian century later the same functions give \(\Delta\psi = +1.5866778139452494\times 10^{-5}\,\mathrm{rad}\) and \(\mathrm{GMST} = 4.9084066632712826\,\mathrm{rad}\).

### Lunar body frame

The Moon keeps the IAU working-group pole and prime meridian: secular \(\alpha_0(T)\), \(\delta_0(T)\), and \(W(d)\), plus the libration arguments \(E_1\) through \(E_{13}\). \(d\) is days and \(T\) is Julian centuries from J2000.0 TT. The matrix sends body-fixed vectors, with \(+X\) on the prime meridian and \(+Z\) along the north pole, into EME2000. This series is that cartographic model. It is not read from a planetary constants kernel.

### Analytic Sun direction

Until the planetary snapshot has loaded, the terminator uses a low-precision geocentric unit vector. Mean longitude and the equation of the center are evaluated in the mean equator of date and rotated back to EME2000 with the IAU 1976 precession \((\zeta, z, \theta)\). The comment on the function bounds it at about \(0.01^\circ\). When the snapshot is available, the Sun direction is the unit vector of the geometric DE440 state of NAIF body 10 relative to the lit body, in EME2000, then mapped into the scene. For the Moon that direction is geocentric, so the terminator differs from a selenocentric Sun by a fraction of a degree.

### Reserved spacecraft attitude

`AttitudeQuaternion` is scalar-last \([x, y, z, w]\) and would rotate body-fixed vectors into EME2000. `attitudeAt` returns null. No attitude file is parsed.

### Scene frame

Scene axes are Y-up. Science \(Z\) (the pole) becomes scene \(Y\), and science \(Y\) becomes scene \(-Z\). Body radii below size the meshes. They do not enter the ephemeris. Barycenters, Lagrange points, and the listed small bodies are an origin mark: a barycenter is not a planet center, and drawing one is not offered for the planets that DE440 stores only as system barycenters.

| Body | Drawn radius (km) | Role of the number |
| --- | --- | --- |
| Earth | 6378.137 | WGS 84 equatorial radius, exact by the ellipsoid definition |
| Moon | 1737.4 | IAU mean radius, drawn as a sphere |
| Sun | 695700 | IAU nominal solar radius |
| Mercury, Venus, Mars | 2439.4, 6051.8, 3396.19 | IAU equatorial radii |
| Jupiter, Saturn, Uranus, Neptune | 71492, 60268, 25559, 24764 | IAU equatorial radii |
| Pluto | 1188.3 | New Horizons mean radius |

## 3. Ephemeris calculation and file support

### Time scales

The scientific clock is a split TAI Julian Date, `tai1 + tai2`, following the ERFA split-date conventions (`eraDat`, `eraDtf2d`, `eraUtctai`, `eraTaiutc`). An OEM sample’s field `t` is TAI seconds from the file origin. The origin is the first UTC sample. Those seconds are not seconds past J2000.

\[
\mathrm{TT} = \mathrm{TAI} + 32.184\,\mathrm{s}.
\]

SPICE ephemeris time is TDB seconds past JD 2451545.0, which is 2000-01-01 12:00 TDB. The converter is

\[
\mathrm{ET} = \big((\mathit{tai}_1 - 2451545) + \mathit{tai}_2\big)\times 86400 + 32.184.
\]

That is \(\mathrm{TDB}=\mathrm{TT}\). The returned quality is `{ kind: "approximate", reason: "tdb-equals-tt" }`. Replacing `tdbSecondsPastJ2000` is the intended way to introduce a TDB−TT series. Callers already keep the quality flag.

Leap seconds come from the IERS `leap-seconds.list` bulletin retrieved 2026-11-11. The file expires 2027-06-28. \(\mathrm{TAI}-\mathrm{UTC} = 37\,\mathrm{s}\) from 2017-01-01. Instants after the expiry still use 37 s and are marked dubious. UTC before 1972-01-01 is rejected: the modern integer table does not describe the rate-offset UTC of 1961–1971.

**Example.** 2000-01-01 12:00:00 UTC. The leap table gives \(\mathrm{TAI}-\mathrm{UTC} = 32\,\mathrm{s}\), so the TAI instant is 12:00:32 and

\[
\mathrm{TT} - \mathrm{J2000\ TT} = 32 + 32.184 = 64.184\,\mathrm{s}.
\]

Under the approximation above, the SPK argument is \(\mathrm{ET} = 64.184\,\mathrm{s}\). The unit test checks this placement. A file whose UTC is 2017-01-01 00:00:00 has \(\mathrm{TAI}-\mathrm{UTC} = 37\,\mathrm{s}\), so \(\mathrm{TT}-\mathrm{UTC} = 69.184\,\mathrm{s}\).

For a spacecraft SPK the file origin is chosen so that clock time \(t = 0\) is the kernel’s earliest ephemeris time, run backwards through the same 32.184 s offset. Adding 32.184 s on the way into the evaluator returns that ephemeris time.

### OEM

OEM 2.0 and 3.0, KVN or XML, one object, any number of segments. The format is detected from the contents after a byte-order mark and leading whitespace. The extension is only a picker hint. Files larger than 50 MB are rejected. Header fields that are preserved: version, `CREATION_DATE`, `ORIGINATOR`, `MESSAGE_ID`, comments, and per segment `OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME`, `REF_FRAME`, `REF_FRAME_EPOCH`, `TIME_SYSTEM`, `START_TIME`, `STOP_TIME`, `USEABLE_START_TIME`, `USEABLE_STOP_TIME`, `INTERPOLATION`, and `INTERPOLATION_DEGREE`. Covariance is kept and not drawn. Comments are shown as text.

State rows are epoch, position, velocity, and optional acceleration. KVN units are km, km/s, and km/s². XML units are checked when present. Stored values are meters. Samples outside the usable window remain available as interpolation support and are not part of the drawn arc.

A segment is evaluated when all of the following hold:

- `TIME_SYSTEM = UTC`
- `CENTER_NAME` is in the SANA orbit-center subset listed below
- `REF_FRAME` is `EME2000`, `GCRF`, or `ICRF`
- the interpolation method is one this viewer implements

Anything else still opens in the inspector. A view that needs the missing transform says why.

The center list is a subset of the SANA Orbit Centers registry (`https://sanaregistry.org/r/orbit_centers/`, updated 2023-05-17). Matching ignores case, repeated spaces, and parentheses around a leading catalog number: EARTH, MOON, EARTH BARYCENTER, EARTH-MOON L1, EARTH-MOON L2, the Sun and the planets through Pluto together with their barycenters, SOLAR SYSTEM BARYCENTER, SUN-EARTH L1, SUN-EARTH L2, and the named small bodies in `src/core/centers.ts`. Segments that name different centers are not translated onto one origin. The clock follows the segment that covers the epoch and draws that center, plus the other segments that share it.

Interpolation, in `src/core/interpolate.ts`:

| Declaration | What is evaluated |
| --- | --- |
| Method and degree both omitted | Two-node cubic Hermite, labeled **Viewer default — cubic Hermite** |
| `LINEAR`, degree omitted or 1 | Independent linear series for position and for velocity |
| `LAGRANGE`, integer degree 1 through 12 | Barycentric Lagrange. Velocity is its own series on the velocity samples |
| `HERMITE`, degree 3, 5, 7, 9, or 11 | Position and velocity together. Degree 3 is the closed cubic. Higher odd degrees are a Newton form on repeated nodes |

An exact sample epoch returns the stored state. There is no extrapolation and no SGP4. Overlapping usable windows are not merged. The segment already in view stays while it still covers the epoch. Otherwise the clock uses the covering segment that started latest. A shared boundary that carries two states is a discontinuity.

The two-node Hermite cubic on one component, with \(h = t_1-t_0\) and \(u = (t-t_0)/h\), is

\[
\begin{aligned}
p(u) &= (2u^3-3u^2+1)\,p_0 + (u^3-2u^2+u)\,h\,v_0 \\
&\quad + (-2u^3+3u^2)\,p_1 + (u^3-u^2)\,h\,v_1, \\
v(t) &= \frac{1}{h}\frac{\mathrm{d}p}{\mathrm{d}u}.
\end{aligned}
\]

**Example.** \(t_0 = 0\), \(p_0 = 0\), \(v_0 = 1\), \(t_1 = 1\), \(p_1 = 1\), \(v_1 = 0\), evaluated at \(t = 0.5\). Then \(u = 1/2\) and

\[
p = 0.625, \qquad v = 1.25
\]

in the units of the samples. For a Lagrange segment the same numbers would not be obtained by differentiating \(p\): position and velocity are interpolated separately. An exact node returns the stored component, so the samples \((0,1),\ (10,8),\ (20,27),\ (30,64)\) give 27 at time 20.

### SPK

A local file whose first bytes are `DAF/SPK` is read in the browser, under the same 50 MB cap, and is not uploaded. The reader accepts little-endian `LTL-IEEE` files. A summary is five double words (`ND = 2`, `NI = 6`): target, center, frame, type, initial address, final address, and the coverage endpoints in TDB seconds past J2000. Addresses are 1-based double-word indexes.

Supported data types, and only in NAIF frame 1:

| Type | Contents | Position | Velocity |
| --- | --- | --- | --- |
| 2 | Chebyshev position polynomials, equal intervals | Clenshaw value | \((\mathrm{d}P/\mathrm{d}s)/\mathrm{radius}\) |
| 3 | Chebyshev position and velocity polynomials | Clenshaw value of the position set | Clenshaw value of the stored velocity set |
| 8 | Equally spaced Cartesian states | Lagrange on each component | Lagrange on the stored velocity, not \(\mathrm{d}\mathbf{r}/\mathrm{d}t\) |
| 9 | Unequally spaced Cartesian states | same | same |
| 12 | Equally spaced states, Hermite | Newton form on position and velocity | derivative of that polynomial |
| 13 | Unequally spaced states, Hermite | same | same |

Window selection follows the SPK rule and is stricter about unsupported data. Kernels are searched latest first, and segments inside a kernel are searched latest first. Coverage is closed. The first covering segment in that order is the one that is used. If its type is not in the table, or its frame is not frame 1, evaluation fails. An older segment is not substituted. A time that misses every segment is `outside-coverage` or `gap`, and those gaps are not bridged by a drawn line.

For types 8 and 9 the Lagrange window is the one in the SPK required reading. An even window places the request between the two central states. Near either end the window is clamped so that it still contains a full set of states. An exact state epoch belongs to the later window. Types 12 and 13 store the window size, and the Hermite degree is \(2\times\mathrm{window}-1\).

**Hermite check used by the tests** (Burden & Faires). Nodes \(x = -1, 0, 3, 5\), values \(6, 5, 2210, 78180\), derivatives \(3, 0, 5115, 109395\). At \(x = 2\) the Newton form returns value 141 and derivative 456.

Center changes are vector subtraction in one inertial frame, so the velocity difference has no angular-rate term. If the selected segment’s center is already the requested center, that segment is evaluated and the chain stops. A spacecraft kernel written relative to Earth (NAIF 399) therefore works with no planetary kernel present. Otherwise each body is walked to the solar-system barycenter (id 0, the zero vector) and the two barycentric states are subtracted. A repeated body in that walk is `unresolved-center`.

The OEM interpolator is not a fallback for an SPK. An SPK opened as a trajectory reuses the segment list and the clock, with empty samples and interpolation marked unsupported, so `stateAt` cannot invent states. Playback calls the SPK evaluator.

## 4. Planetary and lunar ephemerides

The page loads `public/ephemeris/de440-earth-moon-sun.bsp` when a neighbor or an ephemeris Sun direction is needed. The file is 7,380,992 bytes and is not in the JavaScript bundle. It is a cut of the NAIF DE440 planetary ephemeris, not a resample. Every source Chebyshev record whose interval overlaps the window is copied with its own degree, interval length, and first boundary.

Source kernel:

`https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp`

SHA-256 `a4ce9bf9b3282becc9f4b2ac3cebe03a2ae7599981aabd7265fd8482fff7c4b5`.

The requested window is 1950-01-01 00:00 through 2050-01-01 00:00 on the ephemeris-time scale, which is \(\mathrm{ET} \in [-1\,577\,880\,000,\ +1\,577\,880\,000]\,\mathrm{s}\). Records are kept out to the native interval boundaries, so the stored segments run from \(-1\,578\,052\,800\,\mathrm{s}\) to \(+1\,577\,966\,400\,\mathrm{s}\). The output SHA-256 is `abbcf6d4f99b669d0df389630d9ee6a3ba3e97d5b96418a584bb63c4233036e5`, recorded with the source checksum in `de440-earth-moon-sun.json`.

All four segments are type 2, frame 1, little-endian. Later segments in the file have higher priority. The order is EMB, Sun, Moon, Earth.

| Target | Center | Interval (s) | Degree | Records | Coefficient sets |
| --- | --- | --- | --- | --- | --- |
| 3, Earth–Moon barycenter | 0, SSB | 1,382,400 (16 d) | 12 | 2283 | position, \(X\) \(Y\) \(Z\) |
| 10, Sun | 0, SSB | 1,382,400 (16 d) | 10 | 2283 | position |
| 301, Moon | 3, EMB | 345,600 (4 d) | 12 | 9132 | position |
| 399, Earth | 3, EMB | 345,600 (4 d) | 12 | 9132 | position |

Mercury through Pluto exist in the full DE440 file as system barycenters (ids 1, 2, 4–9) relative to the SSB. Those segments are not in this cut. Ids 199 and 299 in the full file are small planet-versus-barycenter offsets and are not served. Id 3 is the Earth–Moon barycenter, not Earth. Id 399 is Earth. The neighbor list therefore maps only EARTH → 399, MOON → 301, EARTH BARYCENTER → 3, SUN → 10, and SOLAR SYSTEM BARYCENTER → 0. From Earth the Moon is drawn. From the Moon the Earth is drawn. From the Sun, Earth and the Moon are drawn. From the Earth–Moon barycenter or the solar-system barycenter, the Sun, Earth, and Moon are drawn. The body at the origin is the center itself and is not drawn a second time. Other centers get no neighbor from this snapshot.

### Chebyshev evaluation

One Clenshaw recurrence evaluates every coefficient set. On a record the independent variable is

\[
s = \frac{\mathrm{ET} - t_{\mathrm{mid}}}{\rho}, \qquad s \in [-1, 1],
\]

where \(\rho\) is the interval half-length in seconds (the second word of the record). The polynomial is \(\sum_k c_k T_k(s)\), with \(T_k\) the Chebyshev polynomials of the first kind, matching SPICE `CHBINT`. The record index is \(\lfloor (\mathrm{ET} - t_{\mathrm{init}}) / \Delta t \rfloor\), clamped to the segment. An internal boundary belongs to the later record. The exact end of the segment clamps to the last record.

Type 2 stores three position polynomials. Velocity is the chain rule:

\[
\frac{\mathrm{d}P}{\mathrm{d}t} = \frac{1}{\rho}\frac{\mathrm{d}P}{\mathrm{d}s}.
\]

Type 3 stores six polynomials. Velocity is the value of the velocity polynomial. It is already in kilometers per second, and it is not \(\rho^{-1}\mathrm{d}P/\mathrm{d}s\). The committed snapshot is entirely type 2. Type 3 is implemented and covered by its own coefficient test.

**Example, type 2, one axis.** Coefficients \(c_0 = 1\), \(c_1 = 0\), \(c_2 = 1/2\), so

\[
P(s) = T_0 + \tfrac12 T_2(s) = s^2 + \tfrac12.
\]

At \(s = 1/2\), \(P = 0.75\) and \(\mathrm{d}P/\mathrm{d}s = 1\). On a lunar-sized half-interval \(\rho = 172\,800\,\mathrm{s}\) the velocity contribution of this axis is \(1/172\,800\,\mathrm{km\,s^{-1}}\). A real DE440 record is thirteen coefficients long at degree 12, and the three axes are independent.

### Earth, Moon, and EMRAT

The served Earth and Moon are the native segments: Earth relative to the EMB, and the Moon relative to the EMB. The mass ratio is a check, not a replacement for those segments. It is taken from `gm_de440.tpc` (SHA-256 `924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140`):

\[
\begin{aligned}
GM_\oplus &= 398\,600.43550702266\,\mathrm{km^3\,s^{-2}}, \\
GM_M &= 4\,902.80011845755\,\mathrm{km^3\,s^{-2}}, \\
\mathrm{EMRAT} &= GM_\oplus / GM_M = 81.30056822149722.
\end{aligned}
\]

If \(\mathbf{m}\) is the EMB-to-Moon vector and \(\mathbf{b}\) is the EMB relative to the SSB,

\[
\mathbf{r}_{\oplus} = \mathbf{b} - \mathbf{m}/\mathrm{EMRAT}, \qquad
\mathbf{r}_{M} = \mathbf{b} + \mathbf{m}.
\]

The same scale applies to velocity. If instead \(\mathbf{d}\) is an Earth-to-Moon vector, the Earth result is \(\mathbf{b} - \mathbf{d}/(1+\mathrm{EMRAT})\). The two formulas take different inputs.

**Example, \(\mathrm{ET} = 0\), CSPICE N0067, frame J2000, aberration `NONE`.** These are geometric ICRF kilometers from `tests/fixtures/de440-cspice.json`. The JavaScript evaluator must reproduce them inside the residuals above.

Moon relative to Earth:

\[
\mathbf{r} = (-291\,608.38463343546,\ -266\,716.83339423337,\ -76\,102.48709990202)\,\mathrm{km},
\]

\[
|\mathbf{r}| = 402\,448.640\,\mathrm{km}, \qquad
\mathbf{v} = (0.643531387719,\ -0.666087684092,\ -0.301325704982)\,\mathrm{km\,s^{-1}}.
\]

Earth relative to the SSB, speed \(30.285256\,\mathrm{km\,s^{-1}}\):

\[
\mathbf{r}_{\oplus/\mathrm{SSB}} = (-27\,566\,740.482806,\ 132\,361\,381.153544,\ 57\,418\,653.286251)\,\mathrm{km}.
\]

Moon relative to the EMB:

\[
\mathbf{m} = (-288\,065.17234541546,\ -263\,476.06800028845,\ -75\,177.79740766216)\,\mathrm{km}.
\]

Then \(-\mathbf{m}/\mathrm{EMRAT}\) is

\[
(3\,543.212288020,\ 3\,240.765393945,\ 924.689692240)\,\mathrm{km},
\]

which matches the native Earth-from-EMB state in the same fixture

\[
(3\,543.212288020,\ 3\,240.765393945,\ 924.689692240)\,\mathrm{km}
\]

at the last printed digit. The fixture’s recorded EMRAT residual of Earth relative to the SSB is 0.0 km at its sample epochs. The state the viewer serves is still the native Earth segment.

The Sun at the same epoch is \(1\,147\,128.797\,\mathrm{km}\) from the SSB, which is the planetary offset of the barycenter and not a solar radius.

## 5. Data handling and pipeline

Everything the user opens is local. The page reads an `ArrayBuffer` or decodes OEM text in the browser. File contents are not posted to a server. The sample button requests only a file that was bundled with the page. The planetary snapshot is fetched from the same origin as a static file.

1. **Identify the file.** After the 50 MB check, the leading bytes `DAF/SPK` select the SPK path. Anything else is decoded as OEM text.
2. **Parse off the main thread.** A worker reads the OEM into samples, or reads the SPK summaries into a trajectory shell. The shell carries coverage, center, frame, and interpolation metadata. Its sample list is empty and its interpolation plan is unsupported.
3. **Bind the kernel.** The worker cannot return a usable buffer alias, so the main thread keeps the SPK bytes and attaches them to the parsed object. Evaluation reads those bytes.
4. **Advance a TAI clock.** Playback time is TAI seconds from the file origin. Display epochs are formatted from the split Julian Date. A pre-1972 instant fails the leap-second conversion and is shown as an em dash.
5. **Evaluate.** OEM playback calls the OEM interpolator, then `sourceToEme2000` when the segment is GCRF or ICRF. SPK playback converts the clock instant to ephemeris time, selects the window, evaluates in kilometers, converts to meters once, and applies the frame bias once when EME2000 was requested.
6. **Place neighbors.** For a center the snapshot knows, each neighbor is `stateRelative` of that body with respect to the center, then `toScene`. A failure hides that body for the frame. The group is created hidden so a body does not appear at the origin while the kernel loads.
7. **Light and orient.** The Sun unit vector comes from the snapshot when the lit body is not the Sun. Otherwise the analytic direction is used. Earth orientation uses the file UTC as UT1 and TT = TAI + 32.184 s. The Moon uses its libration series on TT.

SPK arcs drawn on screen are sampled from the evaluator, with a chord tolerance of 1.5 km. A later segment of the same target owns the shared endpoint, with a \(10^{-6}\,\mathrm{s}\) gap so the two windows do not both claim the instant. A handoff whose time gap is under 1 s and whose positions agree within 1 m is drawn as one arc. A larger jump stays two arcs. An unsupported window remains in the segment list, with no samples.

Float64 is the working type for states, coefficients, and time. The scene then scales meters to kilometers.

To rebuild the snapshot from a local copy of `de440.bsp` and `gm_de440.tpc` (both gitignored under `data/`):

```sh
CUT_DE440=1 npx vitest run tests/generate-snapshot.test.ts
```

The discrete CSPICE fixture is regenerated with `data/venv/bin/python scripts/discrete-fixtures.py`. The full kernel and the Python environment are not part of the published tree. The reduced SPK, its manifest, and the small fixtures are.

## 6. Materials

### 6.1 Star catalogue

Stars are the Extended Hipparcos Compilation (XHIP; Anderson & Francis 2012, *Astronomy Letters* 38, 331) cut at visual magnitude 6, as packaged for ofrohn/d3-celestial and stored in `public/skymap.json`. Each star is placed from its catalogue right ascension and declination:

\[
\hat{\mathbf{u}} = (\cos\delta\cos\alpha,\ \cos\delta\sin\alpha,\ \sin\delta)
\]

in the EME2000 axes, then mapped with \((X, Z, -Y)\). The catalogue positions are the published J2000 equatorial angles. Proper motion, parallax, annual aberration, and the ICRS frame bias are not applied. At the scale of a magnitude-limited point sprite the bias is far below a pixel; it is still not a reduction to the dynamical equinox, and the stars are not an astrometric reference.

Color is a B−V lookup on the d3-celestial red-to-blue ramp, from B−V \(= 3.347\) to B−V \(= -0.335\), then mixed halfway back toward luminance so the screen saturation is half of that ramp. A missing B−V stays white. Point diameter in CSS pixels is \(\max\big(1.8,\ 9\exp[-0.28\,(m_V+2)]\big)\).

### 6.2 Body texture

Equirectangular maps have the date line at the left and right edges and longitude 0° at the center. The mesh local \(+X\) is that prime meridian and local \(+Y\) is north, before the EME2000 rotation.

| Map | File | What it is |
| --- | --- | --- |
| Earth day, night, clouds | `public/textures/earth-day.jpg`, `earth-night.jpg`, `earth-cloud-day.jpg` | Equirectangular maps already in the repository. Their image metadata does not identify a public source, so this document does not assign one. |
| Moon | `public/textures/moon.jpg` | NASA Scientific Visualization Studio CGI Moon Kit color map, a work of the United States Government, centered on 0° longitude. The crust rotation is the IAU series in section 2. |
| Sun | none | Untextured sphere of radius 695700 km. |
| Minimal style | none | Gray sphere, `#3a3a3c`, for the Moon and the planets when the realistic maps are off. |
| Lens flare | shader in `src/view/SunFlare.tsx` | CC0 shader from ektogamat/R3F-Ultimate-Lens-Flare. Neighbor bodies occlude it. The flare is mounted when the scene center is the Sun. |

No further body maps are shipped. A planet without a texture is not given a spin model.

## 7. Technology and licenses

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
- DE440 and `gm_de440.tpc` are NAIF generic kernels from the JPL server named in the manifest. The repository publishes the trimmed SPK and the four constants, identified by the SHA-256 values above.
- The leap-second table is the IERS Bulletin C list named in `src/core/time.ts`.
- XHIP positions are used as packaged by d3-celestial. The citation is Anderson & Francis 2012.
- The lunar color map is a NASA SVS product, a United States Government work.
- CSPICE N0067, through spiceypy, is the validation oracle. It is installed in the gitignored `data/` environment and is not a runtime dependency.

Interpolation tests use analytic polynomials. The 2016-12-31 leap second is checked on the TAI scale. `example.oem` is the NASA/JSC EM-2 ephemeris included with this repository (EME2000, UTC, April 2026). It is a sample trajectory, not an independent orbit determination.
