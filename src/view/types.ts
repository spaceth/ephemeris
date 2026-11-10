import type { OemFile } from "../core";

export type SceneClock = {
  file: OemFile | null;
  t: number;
  segment: number;
};
