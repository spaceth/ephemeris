export const CAMERA_MODES = [
  { id: "overview", label: "Overview" },
  { id: "follow", label: "Follow" },
  { id: "pov", label: "PoV" },
  { id: "cinematic", label: "Cinematic" },
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number]["id"];

/** What Follow, PoV, and Cinematic look at. Overview ignores this and frames the origin. */
export type CameraFocus =
  | { kind: "craft" }
  | { kind: "center" }
  | { kind: "body"; id: number };

export function focusKey(focus: CameraFocus): string {
  return focus.kind === "body" ? `body:${focus.id}` : focus.kind;
}

/** Spacecraft when a file is open. The viewing center otherwise. */
export function defaultFocus(hasCraft: boolean): CameraFocus {
  return hasCraft ? { kind: "craft" } : { kind: "center" };
}

/** Label dataset (`data-focus`, `data-body-id`) back into a focus target. */
export function focusFromLabel(kind: string | null, bodyId: string | null): CameraFocus | null {
  if (kind === "craft" || kind === "center") return { kind };
  if (kind === "body") {
    const id = Number(bodyId);
    if (Number.isInteger(id)) return { kind: "body", id };
  }
  return null;
}
