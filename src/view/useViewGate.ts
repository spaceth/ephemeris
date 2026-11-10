import { useEffect, useState } from "react";

export type ViewGate = "welcome" | "leave" | "open" | "view";

const LEAVE_MS = 180;
const OPEN_MS = 720;

/** Welcome stays up until a file arrives, then a short opening hands off to the viewer. A new file replays the opening. */
export function useViewGate(file: object | null): ViewGate {
  const [gate, setGate] = useState<ViewGate>(file ? "view" : "welcome");

  useEffect(() => {
    if (!file) {
      setGate("welcome");
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setGate("view");
      return;
    }
    setGate("leave");
    const openAt = window.setTimeout(() => setGate("open"), LEAVE_MS);
    const viewAt = window.setTimeout(() => setGate("view"), OPEN_MS);
    return () => {
      window.clearTimeout(openAt);
      window.clearTimeout(viewAt);
    };
  }, [file]);

  return gate;
}
