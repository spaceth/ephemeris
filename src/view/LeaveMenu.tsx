import { useState } from "react";

export function LeaveMenu({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className={asking ? "leave-menu is-asking" : "leave-menu"}>
      <button
        type="button"
        className="round-control pressable"
        aria-expanded={asking}
        aria-label={asking ? "Cancel return to the main menu" : "Close"}
        onClick={() => setAsking((value) => !value)}
      >
        Close
      </button>
      <div className="leave-ask" inert={!asking}>
        <div>
          <p>Return to the main menu?</p>
          <button type="button" className="round-control pressable" onClick={() => { if (asking) onConfirm(); }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
