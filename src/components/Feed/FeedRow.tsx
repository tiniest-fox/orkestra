//! Shared 4-column grid row used by FeedTaskRow and FeedSubtaskRow.

import { useMemo, useRef } from "react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { computePipelineSegments } from "../../utils/pipelineSegments";
import { HotkeyScope } from "../ui/HotkeyScope";
import { useNavItem } from "../ui/NavigationScope";
import { FeedRowActions } from "./FeedRowActions";
import { PipelineBar } from "./PipelineBar";
import { StatusSymbol } from "./StatusSymbol";
import { SubtaskProgressBar } from "./SubtaskProgressBar";

interface FeedRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  paddingClass: string;
  subtitle: React.ReactNode;
  faded?: boolean;
  isSubtask?: boolean;
  isFocused?: boolean;
  /** When true, shows a waiting indicator instead of the task's derived status symbol. */
  waiting?: boolean;
  onMouseEnter?: () => void;
  onReview?: () => void;
  onAnswer?: () => void;
  onApprove?: () => void;
  onMerge?: () => void;
  onOpenPr?: () => void;
  onClick?: () => void;
  /** Replaces the default HotkeyScope+FeedRowActions last column when provided. */
  actionsSlot?: React.ReactNode;
}

export function FeedRow({
  task,
  config,
  paddingClass,
  subtitle,
  faded,
  isSubtask,
  isFocused,
  waiting,
  onMouseEnter,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
  onClick,
  actionsSlot,
}: FeedRowProps) {
  const segments = useMemo(() => computePipelineSegments(task, config), [task, config]);
  const rowRef = useRef<HTMLDivElement>(null);
  useNavItem(task.id, rowRef);

  return (
    // biome-ignore lint/a11y/useSemanticElements: grid layout requires div; role+tabIndex+onKeyDown provide accessibility
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.();
      }}
      className={`grid grid-cols-[24px_18px_minmax(0,1fr)_80px_120px_minmax(0,1fr)_160px] gap-4 ${paddingClass} py-2 min-h-[40px] items-center border-l-2 transition-[background-color,border-color] duration-100 ease-out ${isFocused ? "bg-accent-soft border-l-accent" : "border-l-transparent hover:bg-canvas"}${faded && !isFocused ? " opacity-50" : ""}`}
    >
      {isSubtask ? (
        <>
          <div />
          <span className="text-center font-mono text-sm text-text-quaternary self-start">↳</span>
        </>
      ) : (
        <StatusSymbol task={task} waiting={waiting} />
      )}
      <div className={`min-w-0 ${!isSubtask ? "col-span-2" : ""}`}>
        <div className="font-sans text-[13px] font-medium tracking-[-0.01em] truncate text-text-primary">
          {task.title || task.description}
        </div>
        <div className="font-mono text-[10px] text-text-quaternary">{task.id}</div>
        <div className="font-mono text-[10px] font-medium text-text-tertiary">{subtitle}</div>
      </div>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-text-quaternary text-right truncate">
        {task.derived.current_stage ?? ""}
      </div>
      <PipelineBar segments={segments} />
      <div>
        {task.derived.subtask_progress && (
          <SubtaskProgressBar progress={task.derived.subtask_progress} />
        )}
      </div>
      {actionsSlot ?? (
        <HotkeyScope active={isFocused ?? false}>
          <div className="flex items-center gap-2 shrink-0">
            <FeedRowActions
              task={task}
              onReview={onReview ?? (() => {})}
              onAnswer={onAnswer ?? (() => {})}
              onApprove={onApprove ?? (() => {})}
              onMerge={onMerge ?? (() => {})}
              onOpenPr={onOpenPr ?? (() => {})}
            />
          </div>
        </HotkeyScope>
      )}
    </div>
  );
}
