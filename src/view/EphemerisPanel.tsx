import { useEffect, useRef } from "react";
import type { OemFile, OemSegment } from "../core";
import { HideButton } from "./HideButton";
import { Metadata, MinimalMeta } from "./Metadata";
import { useBoxMotion } from "./useBoxMotion";

export function EphemerisPanel({
  file,
  fileName,
  segment,
  covering,
  loading,
  error,
  open,
  onToggle,
  onSelectSegment,
  onHeight,
}: {
  file: OemFile;
  fileName: string;
  segment: number;
  covering: OemSegment[];
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: () => void;
  onSelectSegment: (index: number) => void;
  onHeight: (height: number) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useBoxMotion(open, panelRef);

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const measure = () => onHeight(node.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [onHeight, open]);

  return (
    <aside ref={panelRef} className={open ? "panel material tool-enter" : "panel material is-collapsed tool-enter"}>
      <div className="box-head">
        <h2 className="box-title">Ephemeris</h2>
        <HideButton open={open} label="metadata" onClick={onToggle} />
      </div>
      {loading && <p className="meta">Reading…</p>}
      {error && <p className="fail" role="alert">{error}</p>}
      <div className="box-body">
        {open ? (
          <Metadata
            file={file}
            fileName={fileName}
            segment={segment}
            covering={covering}
            onSelectSegment={onSelectSegment}
          />
        ) : (
          <MinimalMeta file={file} fileName={fileName} segment={segment} />
        )}
      </div>
    </aside>
  );
}
