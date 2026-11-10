export const CAMERA_MODES = [
  { id: "overview", label: "Overview" },
  { id: "follow", label: "Follow" },
  { id: "pov", label: "PoV" },
  { id: "cinematic", label: "Cinematic" },
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number]["id"];
