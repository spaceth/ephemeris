import { useId, useLayoutEffect, useRef, useState } from "react";
import { CAMERA_MODES } from "./camera";
import type { CameraMode } from "./camera";
import { ChevronIcon } from "./icons";
import { useDismiss } from "./useDismiss";

export function CameraPicker({
  mode,
  disabled,
  onChange,
}: {
  mode: CameraMode;
  disabled: boolean;
  onChange: (mode: CameraMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = CAMERA_MODES.find((item) => item.id === mode) ?? CAMERA_MODES[0];
  useDismiss(open, rootRef, setOpen);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!open || !node) return;
    const place = () => {
      const menu = node.querySelector(".cam-menu");
      if (!menu) return;
      node.classList.remove("is-flip");
      if (menu.getBoundingClientRect().top < 8) node.classList.add("is-flip");
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  return (
    <div className={open ? "cam is-open" : "cam"} ref={rootRef}>
      <button
        type="button"
        className="cam-trigger pressable"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Camera"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{current.label}</span>
        <ChevronIcon className="cam-chevron" />
      </button>
      {open && (
        <ul className="cam-menu" id={listId} role="listbox" aria-label="Camera">
          {CAMERA_MODES.map((item) => (
            <li key={item.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={item.id === mode}
                className="cam-option"
                onClick={() => {
                  setOpen(false);
                  onChange(item.id);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
