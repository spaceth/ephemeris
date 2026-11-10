/**
 * Scene axes are Y-up. Science axes are EME2000: Z toward the pole,
 * X toward the equinox, Y completing a right-handed set.
 *
 * Meters map to scene kilometers:
 *   (X, Y, Z) → (X, Z, −Y) × 10⁻³
 */

const KILO = 1e-3;

export function toScene(x: number, y: number, z: number): [number, number, number] {
  return [x * KILO, z * KILO, -y * KILO];
}

export function fromScene(x: number, y: number, z: number): [number, number, number] {
  return [x / KILO, -z / KILO, y / KILO];
}
