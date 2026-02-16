import { ArrowDown, ArrowUp } from "lucide-react";

interface SyncStatusIndicatorProps {
  ahead: number;
  behind: number;
  size?: "sm" | "md";
}

export function SyncStatusIndicator({ ahead, behind, size = "md" }: SyncStatusIndicatorProps) {
  if (ahead === 0 && behind === 0) return null;

  const iconClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <span className="text-xs text-stone-500 dark:text-stone-400 flex items-center gap-1">
      {ahead > 0 && (
        <span className="flex items-center gap-0.5" title={`${ahead} commit(s) to push`}>
          <ArrowUp className={iconClass} />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center gap-0.5" title={`${behind} commit(s) to pull`}>
          <ArrowDown className={iconClass} />
          {behind}
        </span>
      )}
    </span>
  );
}
