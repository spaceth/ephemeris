/**
 * One placement step for every drawn body and every segment center.
 * The result is an EME2000 vector in meters relative to the viewing center.
 * A missing chain is a failure. Callers omit that body. They do not draw it
 * at the viewing origin.
 *
 * A snapshot body is `stateRelative`. A planet whose ephemeris target is its
 * system barycenter then adds the circle-rule offset. The viewing center
 * itself is the zero vector, including a barycenter whose planet is a neighbor.
 */

import { orbitCenter } from "../centers";
import type { Vec3 } from "../types";
import { moonFromBarycenter, planetFromBarycenter } from "./barycenter";
import { bodyById, naifForCenter, neighborsOf, type BodyRecord } from "./bodies";
import { stateRelative, type SpkKernel } from "./resolve";
import { ephemerisFailure, type EphemerisFailure, type StateQuality } from "./state";

const BASE_QUALITY: StateQuality[] = [
  { kind: "native" },
  { kind: "approximate", reason: "tdb-equals-tt" },
];

const CIRCLE: StateQuality = { kind: "approximate", reason: "barycenter-circle" };

export type Placement =
  | { ok: true; positionM: Vec3; quality: readonly StateQuality[] }
  | EphemerisFailure;

const recorded: EphemerisFailure[] = [];

/** Failures from the latest placements. A repeated reason and message is stored once. */
export function placementRecord(): readonly EphemerisFailure[] {
  return recorded;
}

export function resetPlacementRecord(): void {
  recorded.length = 0;
}

function remember(failure: EphemerisFailure): EphemerisFailure {
  if (!recorded.some((item) => item.reason === failure.reason && item.message === failure.message)) {
    recorded.push(failure);
  }
  return failure;
}

function add(a: Vec3, b: Vec3, sign: number): Vec3 {
  return [a[0] + sign * b[0], a[1] + sign * b[1], a[2] + sign * b[2]];
}

function circleMotion(body: BodyRecord, secondsPastJ2000: number): { positionM: Vec3; velocityMps: Vec3 } {
  const offset = body.placement === "barycenter-offset"
    ? planetFromBarycenter(body.id, secondsPastJ2000)
    : body.placement === "satellite"
      ? moonFromBarycenter(body.id, secondsPastJ2000)
      : null;
  if (!offset) return { positionM: [0, 0, 0], velocityMps: [0, 0, 0] };
  return {
    positionM: [offset.positionKm[0] * 1000, offset.positionKm[1] * 1000, offset.positionKm[2] * 1000],
    velocityMps: [offset.velocityKmS[0] * 1000, offset.velocityKmS[1] * 1000, offset.velocityKmS[2] * 1000],
  };
}

function circleOffsetM(body: BodyRecord, secondsPastJ2000: number): Vec3 {
  return circleMotion(body, secondsPastJ2000).positionM;
}

function onCircle(body: BodyRecord): boolean {
  return body.placement === "barycenter-offset" || body.placement === "satellite";
}

/**
 * EME2000 meters of `bodyId` relative to `viewingCenterId`.
 * `kernels` is the planetary snapshot. It is not required when both bodies
 * share a chain target, because that difference is the circle-rule offset.
 */
export function place(
  bodyId: number,
  viewingCenterId: number | null,
  kernels: readonly SpkKernel[],
  secondsPastJ2000: number,
): Placement {
  if (viewingCenterId == null) {
    return remember(ephemerisFailure("unresolved-center", "The viewing center has no NAIF id."));
  }
  const body = bodyById(bodyId);
  const view = bodyById(viewingCenterId);
  if (!body || !view) {
    return remember(ephemerisFailure("unresolved-center", `No catalog chain from ${bodyId} to ${viewingCenterId}.`));
  }
  const bodyOffset = circleOffsetM(body, secondsPastJ2000);
  const viewOffset = circleOffsetM(view, secondsPastJ2000);
  const circle = onCircle(body) || onCircle(view);
  if (body.chain === view.chain) {
    const quality = circle ? [...BASE_QUALITY, CIRCLE] : BASE_QUALITY;
    return { ok: true, positionM: add(bodyOffset, viewOffset, -1), quality };
  }
  if (kernels.length === 0) {
    return remember(ephemerisFailure("missing-dependency", `No planetary kernel can place ${bodyId} from ${viewingCenterId}.`));
  }
  const state = stateRelative(kernels, body.chain, view.chain, secondsPastJ2000, "EME2000", BASE_QUALITY);
  if (!state.ok) return remember(state);
  const quality = circle ? [...state.state.quality, CIRCLE] : state.state.quality;
  return { ok: true, positionM: add(add(state.state.positionM, bodyOffset, 1), viewOffset, -1), quality };
}

/**
 * Position and velocity of `place`, EME2000 meters and meters per second.
 * The velocity follows the same chain, including the circle-rule rate.
 */
export function placeMotion(
  bodyId: number,
  viewingCenterId: number | null,
  kernels: readonly SpkKernel[],
  secondsPastJ2000: number,
): { ok: true; positionM: Vec3; velocityMps: Vec3 } | EphemerisFailure {
  if (viewingCenterId == null) {
    return remember(ephemerisFailure("unresolved-center", "The viewing center has no NAIF id."));
  }
  const body = bodyById(bodyId);
  const view = bodyById(viewingCenterId);
  if (!body || !view) {
    return remember(ephemerisFailure("unresolved-center", `No catalog chain from ${bodyId} to ${viewingCenterId}.`));
  }
  const bodyMove = circleMotion(body, secondsPastJ2000);
  const viewMove = circleMotion(view, secondsPastJ2000);
  if (body.chain === view.chain) {
    return {
      ok: true,
      positionM: add(bodyMove.positionM, viewMove.positionM, -1),
      velocityMps: add(bodyMove.velocityMps, viewMove.velocityMps, -1),
    };
  }
  if (kernels.length === 0) {
    return remember(ephemerisFailure("missing-dependency", `No planetary kernel can place ${bodyId} from ${viewingCenterId}.`));
  }
  const state = stateRelative(kernels, body.chain, view.chain, secondsPastJ2000, "EME2000", BASE_QUALITY);
  if (!state.ok) return remember(state);
  return {
    ok: true,
    positionM: add(add(state.state.positionM, bodyMove.positionM, 1), viewMove.positionM, -1),
    velocityMps: add(add(state.state.velocityMps, bodyMove.velocityMps, 1), viewMove.velocityMps, -1),
  };
}

/**
 * EME2000 meters from the viewing center to a segment center.
 * The same center is the zero vector, including a center the catalog cannot chain.
 * Two different centers are placed only when both have NAIF ids.
 */
export function placeCenter(
  segmentCenter: string | null,
  viewingCenter: string | null,
  kernels: readonly SpkKernel[],
  secondsPastJ2000: number,
): Placement {
  const segment = segmentCenter ? orbitCenter(segmentCenter) : null;
  const viewing = viewingCenter ? orbitCenter(viewingCenter) : null;
  if (segment && viewing && segment.name === viewing.name) {
    return { ok: true, positionM: [0, 0, 0], quality: [{ kind: "native" }] };
  }
  const segmentId = naifForCenter(segmentCenter);
  const viewingId = naifForCenter(viewingCenter);
  if (segmentId == null || viewingId == null) {
    const from = segment?.name ?? segmentCenter ?? "unknown";
    const to = viewing?.name ?? viewingCenter ?? "unknown";
    return remember(ephemerisFailure("unresolved-center", `No NAIF chain from ${from} to ${to}.`));
  }
  return place(segmentId, viewingId, kernels, secondsPastJ2000);
}

/** NAIF id for a center the catalog can chain. */
export function centerNaif(name: string | null): number | null {
  return naifForCenter(name);
}

/** Sized bodies other than the center itself. */
export function defaultNeighbors(centerName: string | null): readonly BodyRecord[] {
  return neighborsOf(centerName);
}
