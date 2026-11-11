/**
 * One Clenshaw evaluator for an SPK Chebyshev coefficient set.
 * The polynomial is sum c_k T_k(s) on s in [-1, 1], matching SPICE CHBINT.
 * `value` is the polynomial. `derivative` is d(value)/ds, not d(value)/dt.
 * Type 2 velocity multiplies `derivative` by 1/radius outside this function.
 * Type 3 velocity evaluates the stored velocity coefficients with `value` only.
 */

export type ChebyshevValue = {
  value: number;
  derivative: number;
};

export function chebyshev(coefficients: ArrayLike<number>, s: number): ChebyshevValue {
  const n = coefficients.length;
  if (n === 0) return { value: 0, derivative: 0 };
  const twice = 2 * s;
  let w0 = 0;
  let w1 = 0;
  let w2 = 0;
  let dw0 = 0;
  let dw1 = 0;
  let dw2 = 0;
  for (let j = 1; j <= n; j += 1) {
    w2 = w1;
    w1 = w0;
    dw2 = dw1;
    dw1 = dw0;
    w0 = twice * w1 - w2 + coefficients[n - j];
    dw0 = twice * dw1 - dw2 + w1 + w1;
  }
  return {
    value: 0.5 * (w0 - w2 + coefficients[0]),
    derivative: 0.5 * (dw0 - dw2),
  };
}
