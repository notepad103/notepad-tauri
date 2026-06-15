interface TermToggleButtonProps {
  active?: boolean;
  count?: number;
  onClick: () => void;
}

export default function TermToggleButton({
  active = false,
  count = 0,
  onClick,
}: TermToggleButtonProps) {
  return (
    <button
      type="button"
      className={`note-term-toggle ${active ? "note-term-toggle-active" : ""}`}
      aria-label="打开名词侧边栏"
      title="名词"
      onClick={onClick}
    >
      <svg
        className="note-term-toggle-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
      {count > 0 && <span className="note-term-toggle-badge">{count}</span>}
    </button>
  );
}
