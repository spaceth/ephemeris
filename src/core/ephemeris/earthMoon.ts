/**
 * Earth from the Earth–Moon barycenter.
 * `m` is the EMB-to-Moon vector stored by a Moon segment whose center is the EMB.
 * `d` is an Earth-to-Moon vector. The two formulas are not interchangeable.
 * EMRAT is Earth mass over Moon mass and is not read from an SPK segment.
 * The same scale is applied to velocity.
 */

import type { Vec3 } from "../types";

export type EmratPair = {
  earth: Vec3;
  moon: Vec3;
};

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** `m` is EMB → Moon. Results are SSB vectors. */
export function earthAndMoonFromEmbVector(emb: Vec3, m: Vec3, emrat: number): EmratPair {
  if (!(emrat > 0)) throw new Error("EMRAT must be positive");
  return {
    earth: sub(emb, scale(m, 1 / emrat)),
    moon: add(emb, m),
  };
}

/** `d` is Earth → Moon. The Earth result is an SSB vector. */
export function earthFromEarthMoonVector(emb: Vec3, d: Vec3, emrat: number): Vec3 {
  if (!(emrat > 0)) throw new Error("EMRAT must be positive");
  return sub(emb, scale(d, 1 / (1 + emrat)));
}
