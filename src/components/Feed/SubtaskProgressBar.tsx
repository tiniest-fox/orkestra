//! Compact subtask progress indicator — N/M count + mini fill bar.

import type { SubtaskProgress } from "../../types/workflow";

interface SubtaskProgressBarProps {
  progress: SubtaskProgress;
  /** If provided, the component is clickable (e.g. to navigate to the subtask list). */
  onClick?: () => void;
}

export function SubtaskProgressBar({ progress, onClick }: SubtaskProgressBarProps) {
  const { done, total, failed } = progress;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const failedPct = total > 0 ? (failed / total) * 100 : 0;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role is conditionally set to "button" when onClick is provided
    <span
      className={`inline-flex items-center gap-1.5 shrink-0${onClick ? " cursor-pointer hover:opacity-75 transition-opacity" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
    >
      <span className="font-mono text-[10px] text-text-tertiary tabular-nums">
        {done}/{total}
      </span>
      <span className="relative w-14 h-[5px] bg-canvas rounded-full overflow-hidden">
        <span
          className="absolute inset-y-0 left-0 bg-status-success rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
        {failed > 0 && (
          <span
            className="absolute inset-y-0 right-0 bg-status-error rounded-full"
            style={{ width: `${failedPct}%` }}
          />
        )}
      </span>
    </span>
  );
}
