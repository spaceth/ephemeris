/**
 * Selected assignments from a NAIF text PCK.
 * Text before the first `\begindata`, and every `\begintext` block, is a comment.
 * A later assignment of the same name replaces an earlier one.
 * `BODY*_RADII` is the body-fixed semi-axes a, b, c in kilometers.
 * `BODY*_POLE_RA` and `BODY*_POLE_DEC` are degrees. `parsePckPoles` keeps the constant term.
 * `parsePckRotations` keeps the pole and prime-meridian polynomials, the nutation
 * terms, and the system phase angles. Pole rates are degrees per Julian century.
 * Prime-meridian rates are degrees per day. Phase-angle rates are degrees per Julian century.
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

/**
 * IAU body-fixed orientation from one text PCK.
 * `ra` and `dec` are the north pole, degrees, as powers of Julian centuries past J2000 TDB.
 * `pm` is the prime meridian, degrees, as powers of days past J2000 TDB.
 * Nutation terms for right ascension and the prime meridian multiply sines of the
 * phase angles. Declination terms multiply cosines. The angles belong to the
 * planetary-system barycenter, `floor(id / 100)`, and each is a polynomial in
 * Julian centuries. The default polynomial degree is 1. `BODY*_MAX_PHASE_DEGREE`
 * raises it, so Mars angles are stored as triples.
 */
export type PckRotation = {
  ra: readonly number[];
  dec: readonly number[];
  pm: readonly number[];
  nutRa: readonly number[];
  nutDec: readonly number[];
  nutPm: readonly number[];
  angles: readonly (readonly number[])[];
};

const NAMED = /BODY(\d+)_([A-Z0-9_]+)\s*=\s*\(([^)]*)\)/g;
const PHASE_DEGREE = /BODY(\d+)_MAX_PHASE_DEGREE\s*=\s*([+-]?\d+)/g;

/** Every complete pole and prime-meridian model in the text. Later assignments win. */
export function parsePckRotations(text: string): Map<number, PckRotation> {
  NAMED.lastIndex = 0;
  PHASE_DEGREE.lastIndex = 0;
  type Draft = {
    ra?: number[];
    dec?: number[];
    pm?: number[];
    nutRa?: number[];
    nutDec?: number[];
    nutPm?: number[];
  };
  const drafts = new Map<number, Draft>();
  const angleCoefficients = new Map<number, number[]>();
  const maxPhaseDegree = new Map<number, number>();
  const draft = (id: number): Draft => {
    let row = drafts.get(id);
    if (!row) {
      row = {};
      drafts.set(id, row);
    }
    return row;
  };

  for (const block of dataBlocks(text)) {
    for (const match of block.matchAll(NAMED)) {
      const id = Number(match[1]);
      const key = match[2];
      const label = `BODY${id}_${key}`;
      if (key === "POLE_RA") draft(id).ra = coefficients(match[3], label);
      else if (key === "POLE_DEC") draft(id).dec = coefficients(match[3], label);
      else if (key === "PM") draft(id).pm = coefficients(match[3], label);
      else if (key === "NUT_PREC_RA") draft(id).nutRa = coefficients(match[3], label);
      else if (key === "NUT_PREC_DEC") draft(id).nutDec = coefficients(match[3], label);
      else if (key === "NUT_PREC_PM") draft(id).nutPm = coefficients(match[3], label);
      else if (key === "NUT_PREC_ANGLES") angleCoefficients.set(id, coefficients(match[3], label));
    }
    for (const match of block.matchAll(PHASE_DEGREE)) {
      maxPhaseDegree.set(Number(match[1]), Number(match[2]));
    }
  }

  const rotations = new Map<number, PckRotation>();
  for (const [id, row] of drafts) {
    if (!row.ra || !row.dec || !row.pm) continue;
    const nutRa = row.nutRa ?? [];
    const nutDec = row.nutDec ?? [];
    const nutPm = row.nutPm ?? [];
    const terms = Math.max(nutRa.length, nutDec.length, nutPm.length);
    const barycenter = Math.trunc(id / 100);
    let angles: number[][] = [];
    if (terms > 0) {
      const packed = angleCoefficients.get(barycenter);
      if (!packed) {
        throw new Error(`BODY${id} nutation terms have no BODY${barycenter}_NUT_PREC_ANGLES`);
      }
      const degree = maxPhaseDegree.get(barycenter) ?? 1;
      angles = phaseAngles(packed, degree, barycenter);
      if (angles.length < terms) {
        throw new Error(`BODY${id} has ${terms} nutation terms and BODY${barycenter} has ${angles.length} angles`);
      }
    }
    rotations.set(id, { ra: row.ra, dec: row.dec, pm: row.pm, nutRa, nutDec, nutPm, angles });
  }
  return rotations;
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

function phaseAngles(packed: readonly number[], degree: number, barycenter: number): number[][] {
  const width = degree + 1;
  if (degree < 1 || packed.length % width !== 0) {
    throw new Error(`BODY${barycenter}_NUT_PREC_ANGLES is not groups of ${width}`);
  }
  const angles: number[][] = [];
  for (let index = 0; index < packed.length; index += width) {
    angles.push(packed.slice(index, index + width));
  }
  return angles;
}

function coefficients(body: string, label: string): number[] {
  const values = body.trim().split(/[\s,]+/).filter(Boolean).map(spiceNumber);
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} is not a list of finite numbers`);
  }
  return values;
}

function spiceNumber(token: string): number {
  const normalized = token.replace(/[dD]/g, "e");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return Number.NaN;
  return Number(normalized);
}
