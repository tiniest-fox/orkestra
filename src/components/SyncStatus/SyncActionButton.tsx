import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";

interface SyncActionButtonProps {
  type: "push" | "pull";
  loading: boolean;
  hasError: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}

export function SyncActionButton({
  type,
  loading,
  hasError,
  onClick,
  size = "md",
}: SyncActionButtonProps) {
  const Icon = type === "push" ? ArrowUp : ArrowDown;
  const label = type === "push" ? "Push to origin" : "Pull from origin";
  const iconClass = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  const baseStyles = "p-1 rounded disabled:opacity-50";
  const normalStyles =
    "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800";
  const errorStyles =
    "text-error-500 dark:text-error-400 hover:bg-error-100 dark:hover:bg-error-900/30";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`${baseStyles} ${hasError ? errorStyles : normalStyles}`}
      title={hasError ? `${label} (failed - click to retry)` : label}
      aria-label={label}
    >
      {loading ? (
        <Loader2 className={`${iconClass} animate-spin`} />
      ) : (
        <Icon className={iconClass} />
      )}
    </button>
  );
}
