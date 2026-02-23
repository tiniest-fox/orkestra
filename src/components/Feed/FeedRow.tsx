//! Shared 4-column grid row used by FeedTaskRow and FeedSubtaskRow.

import { useMemo, useRef } from "react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { computePipelineSegments } from "../../utils/pipelineSegments";
import { useNavItem } from "../ui/NavigationScope";
import { HotkeyScope } from "../ui/HotkeyScope";
import { FeedRowActions } from "./FeedRowActions";
import { IterationBadge } from "./IterationBadge";
import { PipelineBar } from "./PipelineBar";
import { StatusSymbol } from "./StatusSymbol";

interface FeedRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  paddingClass: string;
  subtitle: React.ReactNode;
  faded?: boolean;
  isSubtask?: boolean;
  isFocused?: boolean;
  onMouseEnter?: () => void;
  onReview?: () => void;
  onAnswer?: () => void;
  onMerge?: () => void;
  onOpenPr?: () => void;
  onArchive?: () => void;
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
  onMouseEnter,
  onReview,
  onAnswer,
  onMerge,
  onOpenPr,
  onArchive,
  onClick,
  actionsSlot,
}: FeedRowProps) {
  const segments = useMemo(() => computePipelineSegments(task, config), [task, config]);
  const rowRef = useRef<HTMLDivElement>(null);
  useNavItem(task.id, rowRef);

  return (
    <div
      ref={rowRef}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`grid grid-cols-[24px_18px_minmax(0,1fr)_80px_120px_auto_minmax(0,1fr)_160px] gap-4 ${paddingClass} py-2 min-h-[40px] items-center border-l-2 transition-[background-color,border-color] duration-100 ease-out ${isFocused ? "bg-[var(--accent-bg)] border-l-[var(--accent)]" : "border-l-transparent hover:bg-[var(--surface-hover)]"}${faded && !isFocused ? " opacity-50" : ""}`}
    >
      {isSubtask ? (
        <>
          <div />
          <span className="text-center font-forge-mono text-sm text-[var(--text-3)] self-start">
            ↳
          </span>
        </>
      ) : (
        <StatusSymbol task={task} />
      )}
      <div className={`min-w-0 ${!isSubtask ? "col-span-2" : ""}`}>
        <div className="font-forge-sans text-[13px] font-medium tracking-[-0.01em] truncate text-[var(--text-0)]">
          {task.title || task.description}
        </div>
        <div className="font-forge-mono text-[10px] text-[var(--text-3)]">{task.id}</div>
        <div className="font-forge-mono text-[10px] font-medium text-[var(--text-2)]">
          {subtitle}
        </div>
      </div>
      <div className="font-forge-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--text-3)] text-right truncate">
        {task.derived.current_stage ?? ""}
      </div>
      <PipelineBar segments={segments} />
      <IterationBadge task={task} />
      <div />
      {actionsSlot ?? (
        <HotkeyScope active={isFocused ?? false}>
          <div className="flex items-center gap-2 shrink-0">
            <FeedRowActions
              task={task}
              onReview={onReview ?? (() => {})}
              onAnswer={onAnswer ?? (() => {})}
              onMerge={onMerge ?? (() => {})}
              onOpenPr={onOpenPr ?? (() => {})}
              onArchive={onArchive ?? (() => {})}
            />
          </div>
        </HotkeyScope>
      )}
    </div>
  );
}
