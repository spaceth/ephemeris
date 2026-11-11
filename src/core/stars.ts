/**
 * XHIP stars to magnitude 6, from the Extended Hipparcos Compilation
 * (Anderson & Francis 2012) as published in ofrohn/d3-celestial.
 * Positions are J2000 equatorial, the same mean equator as EME2000 here.
 * The B−V palette and the size exponent are the ones d3-celestial uses.
 */

const DEG = Math.PI / 180;

/** d3 quantize domain [red, blue] for the B−V scale. */
const BV_RED = 3.347;
const BV_BLUE = -0.335;

const BV_COLORS = [
  "#ff4700", "#ff4b00", "#ff4f00", "#ff5300", "#ff5600", "#ff5900", "#ff5b00", "#ff5d00", "#ff6000",
  "#ff6300", "#ff6500", "#ff6700", "#ff6900", "#ff6b00", "#ff6d00", "#ff7000", "#ff7300", "#ff7500",
  "#ff7800", "#ff7a00", "#ff7c00", "#ff7e00", "#ff8100", "#ff8300", "#ff8506", "#ff870a", "#ff8912",
  "#ff8b1a", "#ff8e21", "#ff9127", "#ff932c", "#ff9631", "#ff9836", "#ff9a3c", "#ff9d3f", "#ffa148",
  "#ffa34b", "#ffa54f", "#ffa753", "#ffa957", "#ffab5a", "#ffad5e", "#ffb165", "#ffb269", "#ffb46b",
  "#ffb872", "#ffb975", "#ffbb78", "#ffbe7e", "#ffc184", "#ffc489", "#ffc78f", "#ffc892", "#ffc994",
  "#ffcc99", "#ffce9f", "#ffd1a3", "#ffd3a8", "#ffd5ad", "#ffd7b1", "#ffd9b6", "#ffdbba", "#ffddbe",
  "#ffdfc2", "#ffe1c6", "#ffe3ca", "#ffe4ce", "#ffe8d5", "#ffe9d9", "#ffebdc", "#ffece0", "#ffefe6",
  "#fff0e9", "#fff2ec", "#fff4f2", "#fff5f5", "#fff6f8", "#fff9fd", "#fef9ff", "#f9f6ff", "#f6f4ff",
  "#f3f2ff", "#eff0ff", "#ebeeff", "#e9edff", "#e6ebff", "#e3e9ff", "#e0e7ff", "#dee6ff", "#dce5ff",
  "#d9e3ff", "#d7e2ff", "#d3e0ff", "#c9d9ff", "#bfd3ff", "#b7ceff", "#afc9ff", "#a9c5ff", "#a4c2ff",
  "#9fbfff", "#9bbcff",
];

/** Unit vector in EME2000. Right ascension may be wrapped through ±180°. */
export function starDirection(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
}

/** The same direction in scene axes: (x, y, z) → (x, z, −y). */
export function starScene(raDeg: number, decDeg: number): [number, number, number] {
  const [x, y, z] = starDirection(raDeg, decDeg);
  return [x, z, -y];
}

/** Disc diameter in CSS pixels. Brighter stars are larger, with d3-celestial's exponent. */
export function starPointSize(mag: number): number {
  return Math.max(1.8, 9 * Math.exp(-0.28 * (mag + 2)));
}

function hexRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** sRGB color from a B−V index. Missing indexes stay white. */
export function starColor(bv: number | null): [number, number, number] {
  if (bv == null || Number.isNaN(bv)) return [1, 1, 1];
  const kx = BV_COLORS.length / (BV_BLUE - BV_RED);
  const index = Math.max(0, Math.min(BV_COLORS.length - 1, Math.floor(kx * (bv - BV_RED))));
  return hexRgb(BV_COLORS[index]);
}
