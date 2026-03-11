//! Shared header for Feed drawers — title row + pipeline + session strip.

import { MessageSquare, Play, Square, SquarePen, SquareTerminal, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { RunStatus } from "../../hooks/useRunScript";
import { useTransport } from "../../transport";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { computePipelineSegments } from "../../utils/pipelineSegments";
import { groupIterationsIntoRuns } from "../../utils/stageRuns";
import { Button } from "../ui/Button";
import { useNavHandler } from "../ui/HotkeyScope";
import { Kbd } from "../ui/Kbd";
import { ModalPanel } from "../ui/ModalPanel";
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
  onToggleAutoMode?: () => void;
  autoModeOverride?: boolean;
  showRunButton?: boolean;
  runStatus?: RunStatus;
  runLoading?: boolean;
  onRunStart?: () => Promise<void>;
  onRunStop?: () => Promise<void>;
  onOpenChat?: () => void;
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
  onToggleAutoMode,
  autoModeOverride,
  showRunButton,
  runStatus,
  runLoading,
  onRunStart,
  onRunStop,
  onOpenChat,
}: DrawerHeaderProps) {
  const transport = useTransport();
  const effectiveAutoMode = autoModeOverride ?? task.auto_mode;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const segments = useMemo(() => computePipelineSegments(task, config), [task, config]);
  const runs = useMemo(
    () => groupIterationsIntoRuns(task.iterations, config),
    [task.iterations, config],
  );

  const worktreePath = task.worktree_path;
  useNavHandler("T", () => {
    if (transport.supportsLocalOperations && worktreePath)
      transport.call("open_in_terminal", { path: worktreePath });
  });
  useNavHandler("E", () => {
    if (transport.supportsLocalOperations && worktreePath)
      transport.call("open_in_editor", { path: worktreePath });
  });
  useNavHandler("D", () => {
    setShowDeleteConfirm(true);
  });
  useNavHandler("A", () => {
    if (!task.derived.is_done && !task.derived.is_archived) onToggleAutoMode?.();
  });
  useNavHandler("C", () => {
    if (!task.derived.is_archived) onOpenChat?.();
  });

  return (
    <div className="shrink-0 px-6 pt-4 pb-3 border-b border-border">
      {/* Row 1: Title + external tool links + close */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-sans text-[14px] font-semibold tracking-[-0.01em] text-text-primary leading-snug truncate">
            {task.title || task.description}
          </div>
          <div className="text-[12px] font-mono text-text-quaternary mt-0.5">{task.id}</div>
        </div>
        {task.worktree_path && (
          <div className="shrink-0 flex items-center gap-2 mt-0.5">
            {!task.derived.is_done && !task.derived.is_archived && (
              <label
                className="flex items-center gap-1.5 cursor-pointer select-none mr-1"
                title={`${effectiveAutoMode ? "Disable" : "Enable"} auto mode (⇧A)`}
              >
                <Kbd>⇧A</Kbd>
                <span
                  className={`text-[11px] font-medium transition-colors ${
                    effectiveAutoMode ? "text-purple-500" : "text-text-quaternary"
                  }`}
                >
                  Auto
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={effectiveAutoMode}
                  onClick={onToggleAutoMode}
                  className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors ${
                    effectiveAutoMode ? "bg-purple-500" : "bg-surface-3"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                      effectiveAutoMode ? "translate-x-[17px]" : "translate-x-[3px]"
                    }`}
                  />
                </button>
              </label>
            )}
            {showRunButton && runStatus && (
              <button
                type="button"
                onClick={runStatus.running ? onRunStop : onRunStart}
                disabled={runLoading}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-50 ${
                  runStatus.running
                    ? "text-status-success bg-status-success/10 hover:bg-status-success/20"
                    : "text-text-quaternary hover:text-text-secondary"
                }`}
                title={runStatus.running ? "Stop run script" : "Run project script"}
              >
                {runStatus.running ? (
                  <Square size={10} fill="currentColor" />
                ) : (
                  <Play size={10} fill="currentColor" />
                )}
                {runStatus.running ? "Stop" : "Run"}
              </button>
            )}
            {transport.supportsLocalOperations && (
              <>
                <button
                  type="button"
                  onClick={() => transport.call("open_in_terminal", { path: task.worktree_path })}
                  className="flex items-center gap-1.5 text-text-quaternary hover:text-text-secondary transition-colors"
                  title="Open in terminal (⇧T)"
                >
                  <Kbd>⇧T</Kbd>
                  <SquareTerminal size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => transport.call("open_in_editor", { path: task.worktree_path })}
                  className="flex items-center gap-1.5 text-text-quaternary hover:text-text-secondary transition-colors"
                  title="Open in editor (⇧E)"
                >
                  <Kbd>⇧E</Kbd>
                  <SquarePen size={14} />
                </button>
              </>
            )}
          </div>
        )}
        {!task.derived.is_archived && (
          <button
            type="button"
            onClick={onOpenChat}
            className="shrink-0 flex items-center gap-1.5 text-text-quaternary hover:text-text-secondary transition-colors mt-0.5"
            title="Chat with task assistant (⇧C)"
          >
            <Kbd>⇧C</Kbd>
            <MessageSquare size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="shrink-0 flex items-center gap-1.5 text-text-quaternary hover:text-status-error transition-colors mt-0.5"
          title="Delete task (⇧D)"
        >
          <Kbd>⇧D</Kbd>
          <Trash2 size={14} />
        </button>
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

      <ModalPanel
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80"
      >
        <div className="bg-canvas border border-border rounded-panel shadow-lg p-5 flex flex-col gap-4">
          <div>
            <p className="text-[14px] font-semibold text-text-primary">Delete task?</p>
            <p className="mt-1 text-[13px] text-text-tertiary line-clamp-2">
              {task.title || task.description}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => transport.call("delete_task", { task_id: task.id }).then(onClose)}
            >
              Delete
            </Button>
          </div>
        </div>
      </ModalPanel>
    </div>
  );
}
