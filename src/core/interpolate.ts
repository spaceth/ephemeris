/**
 * Cartesian OEM interpolation.
 *
 * Exact sample epochs return the stored state. Off-sample epochs use only
 * the declared method. Velocity for Lagrange and linear interpolation is a
 * separate series on the velocity samples, not the derivative of position.
 * Hermite uses position and velocity together. The two-node case is the
 * cubic in the product specification. Higher odd degrees use a local
 * Newton form on repeated nodes: n nodes, degree at most 2n−1.
 *
 * Time is scaled by the local window width before a polynomial is built.
 */

export type InterpKind = "hermite" | "lagrange" | "linear";

export type InterpPlan = {
  kind: InterpKind;
  degree: number;
  nodes: number;
  viewerDefault: boolean;
  label: string;
  supported: boolean;
  reason: string | null;
};

const HERMITE_DEGREES = new Set([3, 5, 7, 9, 11]);

export function planInterpolation(
  methodRaw: string | null,
  degree: number | null,
  sampleCount: number,
): InterpPlan {
  const method = methodRaw?.trim().toUpperCase() ?? null;
  if (!method && degree == null) {
    const nodes = 2;
    return {
      kind: "hermite",
      degree: 3,
      nodes,
      viewerDefault: true,
      label: "Viewer default — cubic Hermite",
      supported: sampleCount >= nodes,
      reason: sampleCount >= nodes ? null : "Fewer than two samples, so cubic Hermite cannot be evaluated between epochs",
    };
  }
  if (!method || degree == null && method !== "LINEAR") {
    return unsupported("Interpolation method and degree must both be present, or both omitted");
  }
  if (method === "LINEAR") {
    if (degree != null && degree !== 1) {
      return unsupported(`LINEAR interpolation does not accept degree ${degree}`);
    }
    return {
      kind: "linear",
      degree: 1,
      nodes: 2,
      viewerDefault: false,
      label: "Linear",
      supported: sampleCount >= 2,
      reason: sampleCount >= 2 ? null : "Linear interpolation needs two samples",
    };
  }
  if (method === "LAGRANGE") {
    if (degree == null || !Number.isInteger(degree) || degree < 1 || degree > 12) {
      return unsupported(`Lagrange degree ${degree ?? "absent"} is not implemented (1 through 12)`);
    }
    const nodes = degree + 1;
    return {
      kind: "lagrange",
      degree,
      nodes,
      viewerDefault: false,
      label: `Lagrange degree ${degree}`,
      supported: sampleCount >= nodes,
      reason: sampleCount >= nodes ? null : `Lagrange degree ${degree} needs ${nodes} samples`,
    };
  }
  if (method === "HERMITE") {
    if (degree == null || !HERMITE_DEGREES.has(degree)) {
      return unsupported(
        `Hermite degree ${degree ?? "absent"} is not implemented. Supported degrees are 3, 5, 7, 9, and 11`,
      );
    }
    const nodes = (degree + 1) / 2;
    return {
      kind: "hermite",
      degree,
      nodes,
      viewerDefault: false,
      label: `Hermite degree ${degree}`,
      supported: sampleCount >= nodes,
      reason: sampleCount >= nodes ? null : `Hermite degree ${degree} needs ${nodes} samples`,
    };
  }
  return unsupported(`Interpolation method ${methodRaw} is not implemented`);
}

function unsupported(reason: string): InterpPlan {
  return {
    kind: "linear",
    degree: 0,
    nodes: 0,
    viewerDefault: false,
    label: "Unsupported interpolation",
    supported: false,
    reason,
  };
}

export function bracketIndex(times: readonly number[], t: number): number | null {
  if (t < times[0] || t > times[times.length - 1]) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function windowStart(bracket: number, count: number, n: number): number {
  let start = bracket - Math.floor((count - 2) / 2);
  if (start < 0) start = 0;
  if (start + count > n) start = n - count;
  return start;
}

export function hermiteCubic(
  t0: number,
  p0: number,
  v0: number,
  t1: number,
  p1: number,
  v1: number,
  t: number,
): { p: number; v: number } {
  const h = t1 - t0;
  const u = (t - t0) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const p =
    (2 * u3 - 3 * u2 + 1) * p0 +
    (u3 - 2 * u2 + u) * h * v0 +
    (-2 * u3 + 3 * u2) * p1 +
    (u3 - u2) * h * v1;
  const dpdu =
    (6 * u2 - 6 * u) * p0 +
    (3 * u2 - 4 * u + 1) * h * v0 +
    (-6 * u2 + 6 * u) * p1 +
    (3 * u2 - 2 * u) * h * v1;
  return { p, v: dpdu / h };
}

function hermiteNewton(
  times: readonly number[],
  values: readonly number[],
  derivs: readonly number[],
  t: number,
): { p: number; v: number } {
  const n = times.length;
  const origin = times[0];
  const scale = times[n - 1] - origin || 1;
  const z = new Array<number>(2 * n);
  const q: number[][] = Array.from({ length: 2 * n }, () => new Array<number>(2 * n).fill(0));
  for (let i = 0; i < n; i += 1) {
    const x = (times[i] - origin) / scale;
    z[2 * i] = x;
    z[2 * i + 1] = x;
    q[2 * i][0] = values[i];
    q[2 * i + 1][0] = values[i];
    q[2 * i + 1][1] = derivs[i] * scale;
    if (i > 0) {
      q[2 * i][1] = (q[2 * i][0] - q[2 * i - 1][0]) / (z[2 * i] - z[2 * i - 1]);
    }
  }
  const m = 2 * n;
  for (let i = 2; i < m; i += 1) {
    for (let j = 2; j <= i; j += 1) {
      q[i][j] = (q[i][j - 1] - q[i - 1][j - 1]) / (z[i] - z[i - j]);
    }
  }
  const u = (t - origin) / scale;
  let value = q[0][0];
  let deriv = 0;
  let prod = 1;
  let dprod = 0;
  for (let k = 1; k < m; k += 1) {
    const dz = u - z[k - 1];
    const nextD = dprod * dz + prod;
    const nextP = prod * dz;
    const coeff = q[k][k];
    value += coeff * nextP;
    deriv += coeff * nextD;
    prod = nextP;
    dprod = nextD;
  }
  return { p: value, v: deriv / scale };
}

function barycentric(times: readonly number[], values: readonly number[], t: number): number {
  const origin = times[0];
  const x = times.map((time) => time - origin);
  const tt = t - origin;
  const w = new Array<number>(x.length).fill(1);
  for (let j = 0; j < x.length; j += 1) {
    for (let k = 0; k < x.length; k += 1) {
      if (k !== j) w[j] /= x[j] - x[k];
    }
  }
  let num = 0;
  let den = 0;
  for (let j = 0; j < x.length; j += 1) {
    const d = tt - x[j];
    if (d === 0) return values[j];
    const a = w[j] / d;
    num += a * values[j];
    den += a;
  }
  return num / den;
}

export function interpolateComponent(
  plan: InterpPlan,
  times: readonly number[],
  values: readonly number[],
  derivs: readonly number[],
  bracket: number,
  t: number,
): { p: number; v: number } {
  if (!plan.supported) {
    throw new Error(plan.reason ?? "Interpolation is not supported");
  }
  const start = windowStart(bracket, plan.nodes, times.length);
  const sliceT = times.slice(start, start + plan.nodes);
  const sliceP = values.slice(start, start + plan.nodes);
  const sliceV = derivs.slice(start, start + plan.nodes);
  if (plan.kind === "linear") {
    const u = (t - sliceT[0]) / (sliceT[1] - sliceT[0]);
    return {
      p: sliceP[0] + u * (sliceP[1] - sliceP[0]),
      v: sliceV[0] + u * (sliceV[1] - sliceV[0]),
    };
  }
  if (plan.kind === "lagrange") {
    return {
      p: barycentric(sliceT, sliceP, t),
      v: barycentric(sliceT, sliceV, t),
    };
  }
  if (plan.degree === 3) {
    return hermiteCubic(sliceT[0], sliceP[0], sliceV[0], sliceT[1], sliceP[1], sliceV[1], t);
  }
  return hermiteNewton(sliceT, sliceP, sliceV, t);
}
