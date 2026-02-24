//! Shared header for Feed drawers — title row + pipeline + session strip.

import { invoke } from "@tauri-apps/api/core";
import { SquarePen, SquareTerminal, X } from "lucide-react";
import { useMemo } from "react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { computePipelineSegments } from "../../utils/pipelineSegments";
import { groupIterationsIntoRuns } from "../../utils/stageRuns";
import { useNavHandler } from "../ui/HotkeyScope";
import { Kbd } from "../ui/Kbd";
import { STATUS_HEX } from "../ui/taskStateColors";
import { PipelineBar } from "./PipelineBar";
import { SessionStrip } from "./SessionStrip";
import { SubtaskProgressBar } from "./SubtaskProgressBar";

interface DrawerHeaderProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  onClose: () => void;
  accent: string;
  /** Hide the esc hint (e.g. when a sub-input has focus and esc does something else). */
  escHidden?: boolean;
  /** Index of the selected past run, or null for the current run. */
  selectedRunIdx?: number | null;
  onSelectRun?: (idx: number | null) => void;
  /** If provided, the subtask progress bar is clickable (e.g. to return to the subtask list). */
  onProgressClick?: () => void;
  /** When viewing a waiting-on-children task, clicking the waiting chip shows subtasks. */
  onWaitingChipClick?: () => void;
  isWaitingChipSelected?: boolean;
}

/** Compute the accent color for a drawer from the task's current state. */
export function drawerAccent(task: WorkflowTaskView, config: WorkflowConfig): string {
  if (task.derived.is_failed) return STATUS_HEX.error;
  if (task.derived.has_questions) return STATUS_HEX.info;
  if (task.derived.needs_review) {
    const stage = config.stages.find((s) => s.name === task.derived.current_stage);
    return stage?.capabilities.subtasks ? STATUS_HEX.cyan : STATUS_HEX.purple;
  }
  if (task.derived.is_done) return STATUS_HEX.merge;
  if (task.derived.is_archived) return STATUS_HEX.muted;
  return STATUS_HEX.accent;
}

export function DrawerHeader({
  task,
  config,
  onClose,
  accent,
  escHidden,
  selectedRunIdx = null,
  onSelectRun = () => {},
  onProgressClick,
  onWaitingChipClick,
  isWaitingChipSelected,
}: DrawerHeaderProps) {
  const segments = useMemo(() => computePipelineSegments(task, config), [task, config]);
  const runs = useMemo(
    () => groupIterationsIntoRuns(task.iterations, config),
    [task.iterations, config],
  );

  const worktreePath = task.worktree_path;
  useNavHandler("T", () => {
    if (worktreePath) invoke("open_in_terminal", { path: worktreePath });
  });
  useNavHandler("E", () => {
    if (worktreePath) invoke("open_in_editor", { path: worktreePath });
  });

  return (
    <div className="shrink-0 px-6 pt-4 pb-3 border-b border-border">
      {/* Row 1: Title + external tool links + close */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 font-sans text-[14px] font-semibold tracking-[-0.01em] text-text-primary leading-snug truncate">
          {task.title || task.description}
        </div>
        {task.worktree_path && (
          <div className="shrink-0 flex items-center gap-2 mt-0.5">
            <button
              type="button"
              onClick={() => invoke("open_in_terminal", { path: task.worktree_path })}
              className="flex items-center gap-1.5 text-text-quaternary hover:text-text-secondary transition-colors"
              title="Open in terminal (⇧T)"
            >
              <Kbd>⇧T</Kbd>
              <SquareTerminal size={14} />
            </button>
            <button
              type="button"
              onClick={() => invoke("open_in_editor", { path: task.worktree_path })}
              className="flex items-center gap-1.5 text-text-quaternary hover:text-text-secondary transition-colors"
              title="Open in editor (⇧E)"
            >
              <Kbd>⇧E</Kbd>
              <SquarePen size={14} />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 flex items-center gap-1.5 text-text-quaternary hover:text-text-secondary transition-colors mt-0.5"
          title="Close (Esc)"
        >
          <span className={`flex items-center ${escHidden ? "invisible" : "visible"}`}>
            <Kbd>esc</Kbd>
          </span>
          <X size={14} />
        </button>
      </div>

      {/* Row 2: Session strip + [subtask progress] + pipeline */}
      <div className="mt-2 flex items-center gap-3 min-w-0">
        {runs.length > 0 && (
          <SessionStrip
            runs={runs}
            selectedRunIdx={selectedRunIdx}
            onSelect={onSelectRun}
            accent={accent}
            waitingStage={
              task.derived.is_waiting_on_children
                ? (task.derived.current_stage ?? undefined)
                : undefined
            }
            isWaitingSelected={isWaitingChipSelected}
            onWaitingSelect={onWaitingChipClick}
          />
        )}
        {task.derived.subtask_progress && (
          <SubtaskProgressBar progress={task.derived.subtask_progress} onClick={onProgressClick} />
        )}
        <div className="flex-1 max-w-[160px] ml-auto shrink-0">
          <PipelineBar segments={segments} />
        </div>
      </div>
    </div>
  );
}
