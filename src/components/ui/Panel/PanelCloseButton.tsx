/**
 * Panel.CloseButton - Close button for panels.
 */

interface PanelCloseButtonProps {
  onClick: () => void;
  className?: string;
}

export function PanelCloseButton({ onClick, className = "" }: PanelCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-panel-sm transition-colors ${className}`}
      aria-label="Close"
    >
      <svg
        className="w-5 h-5 text-stone-500 dark:text-stone-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
  );
}
