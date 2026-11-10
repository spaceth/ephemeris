export type Vec3 = [number, number, number];

export type FailReason =
  | "outside-coverage"
  | "gap"
  | "ambiguous-segment"
  | "unsupported-frame"
  | "unsupported-center"
  | "unsupported-time"
  | "unsupported-interpolation";

export type Failure = {
  ok: false;
  reason: FailReason;
  message: string;
};

export function failure(reason: FailReason, message: string): Failure {
  return { ok: false, reason, message };
}
