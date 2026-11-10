export function HideButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="round-control pressable hide-btn"
      aria-expanded={open}
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      onClick={onClick}
    >
      {open ? "Hide" : "Show"}
    </button>
  );
}
