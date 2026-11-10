import type { OemFile } from "../core";
import { formatTaiSeconds } from "../core/time";

export function formatEpoch(file: OemFile, seconds: number, digits = 3): { text: string; dubious: boolean } | null {
  if (!file.origin) return null;
  try {
    return formatTaiSeconds(file.origin, seconds, digits);
  } catch {
    return null;
  }
}
