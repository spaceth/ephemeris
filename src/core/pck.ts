/**
 * Selected assignments from a NAIF text PCK.
 * Text before the first `\begindata`, and every `\begintext` block, is a comment.
 * A later assignment of the same name replaces an earlier one.
 * `BODY*_RADII` is the body-fixed semi-axes a, b, c in kilometers.
 * `BODY*_POLE_RA` and `BODY*_POLE_DEC` are degrees; the constant term is the J2000 pole.
 */

export type PckRadii = readonly [number, number, number];

const ASSIGNMENT = /BODY(\d+)_RADII\s*=\s*\(([^)]*)\)/g;

export function parsePckRadii(text: string): Map<number, PckRadii> {
  const radii = new Map<number, PckRadii>();
  for (const block of dataBlocks(text)) {
    for (const match of block.matchAll(ASSIGNMENT)) {
      const id = Number(match[1]);
      const values = match[2].trim().split(/[\s,]+/).filter(Boolean).map(spiceNumber);
      if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`BODY${id}_RADII is not three finite semi-axes`);
      }
      radii.set(id, [values[0], values[1], values[2]]);
    }
  }
  return radii;
}

export type PckPole = { raDeg: number; decDeg: number };

const POLE = /BODY(\d+)_POLE_(RA|DEC)\s*=\s*\(([^)]*)\)/g;

/** J2000 pole from the constant term of `BODY*_POLE_RA` and `BODY*_POLE_DEC`. Rates are not applied. */
export function parsePckPoles(text: string): Map<number, PckPole> {
  const ra = new Map<number, number>();
  const dec = new Map<number, number>();
  for (const block of dataBlocks(text)) {
    for (const match of block.matchAll(POLE)) {
      const id = Number(match[1]);
      const angle = spiceNumber(match[3].trim().split(/[\s,]+/).filter(Boolean)[0] ?? "");
      if (!Number.isFinite(angle)) throw new Error(`BODY${id}_POLE_${match[2]} has no angle`);
      (match[2] === "RA" ? ra : dec).set(id, angle);
    }
  }
  const poles = new Map<number, PckPole>();
  for (const [id, raDeg] of ra) {
    const decDeg = dec.get(id);
    if (decDeg == null) continue;
    poles.set(id, { raDeg, decDeg });
  }
  return poles;
}

/** Equatorial semi-axis. The two equatorial axes in this kernel agree for every body drawn as a sphere. */
export function equatorialRadiusKm(radii: PckRadii, id: number): number {
  if (radii[0] !== radii[1]) {
    throw new Error(`BODY${id}_RADII equatorial axes differ (${radii[0]}, ${radii[1]})`);
  }
  return radii[0];
}

function dataBlocks(text: string): string[] {
  const blocks: string[] = [];
  let inData = false;
  let current: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const token = line.trim();
    if (token === "\\begindata") {
      if (inData) blocks.push(current.join("\n"));
      inData = true;
      current = [];
      continue;
    }
    if (token === "\\begintext") {
      if (inData) blocks.push(current.join("\n"));
      inData = false;
      current = [];
      continue;
    }
    if (inData) current.push(line);
  }
  if (inData) blocks.push(current.join("\n"));
  return blocks;
}

function spiceNumber(token: string): number {
  const normalized = token.replace(/[dD]/g, "e");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return Number.NaN;
  return Number(normalized);
}
