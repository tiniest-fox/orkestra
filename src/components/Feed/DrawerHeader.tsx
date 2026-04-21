//! Task drawer header — title row (via shared DrawerHeader) + pipeline/session strip row.

import {
  ArrowLeftRight,
  MessageSquare,
  Play,
  SkipForward,
  Square,
  SquarePen,
  SquareTerminal,
  Trash2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { RunStatus } from "../../hooks/useRunScript";
import { useTransport } from "../../transport";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { computePipelineSegments } from "../../utils/pipelineSegments";
import { groupIterationsIntoRuns } from "../../utils/stageRuns";
import { Button } from "../ui/Button";
import { type DrawerAction, DrawerHeader as SharedDrawerHeader } from "../ui/Drawer/DrawerHeader";
import { useNavHandler } from "../ui/HotkeyScope";
import { ModalPanel } from "../ui/ModalPanel";
import { STATUS_HEX } from "../ui/taskStateColors";
import { PipelineBar } from "./PipelineBar";
import { SendToStageModal } from "./SendToStageModal";
import { SessionStrip } from "./SessionStrip";
import { SkipStageModal } from "./SkipStageModal";
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
    const stage = config.flows[task.flow]?.stages.find(
      (s) => s.name === task.derived.current_stage,
    );
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

  // -- Skip / Send-to-Stage modals --
  const [showSkipStage, setShowSkipStage] = useState(false);
  const [showSendToStage, setShowSendToStage] = useState(false);

  // Visible when the task is paused or terminal-but-recoverable (awaiting review, questions,
  // rejection, interrupted, failed, or blocked).
  const canOverrideStage =
    task.derived.needs_review ||
    task.derived.has_questions ||
    task.derived.is_interrupted ||
    task.derived.pending_rejection !== null ||
    task.derived.is_failed ||
    task.derived.is_blocked;

  // All flow-valid stages (including the current stage) for the Change Stage modal.
  const flowStages = useMemo(() => {
    return config.flows[task.flow]?.stages ?? [];
  }, [config, task.flow]);

  const worktreePath = task.worktree_path;
  useNavHandler("T", () => {
    if (transport.supportsLocalOperations && worktreePath)
      transport.call("open_in_terminal", { path: worktreePath });
  });
  useNavHandler("E", () => {
    if (transport.supportsLocalOperations && worktreePath)
      transport.call("open_in_editor", { path: worktreePath });
  });
  useNavHandler("D", () => setShowDeleteConfirm(true));
  useNavHandler("A", () => {
    if (!task.derived.is_done && !task.derived.is_archived) onToggleAutoMode?.();
  });
  useNavHandler("C", () => {
    if (!task.derived.is_archived) onOpenChat?.();
  });

  // Build actions array for the shared header.
  const actions: DrawerAction[] = [
    // Auto mode — available without a worktree
    ...(!task.derived.is_done && !task.derived.is_archived && onToggleAutoMode
      ? [
          {
            icon: <Zap fill={effectiveAutoMode ? "currentColor" : "none"} />,
            label: `${effectiveAutoMode ? "Disable" : "Enable"} auto mode`,
            shortLabel: "Auto",
            hotkeyLabel: "⇧A",
            onClick: onToggleAutoMode,
            active: effectiveAutoMode,
            activeClassName: "text-purple-500",
          },
        ]
      : []),
    // Run, terminal, editor — only when worktree exists
    ...(worktreePath
      ? [
          ...(showRunButton && runStatus
            ? [
                {
                  icon: runStatus.running ? (
                    <Square fill="currentColor" />
                  ) : (
                    <Play fill="currentColor" />
                  ),
                  label: runStatus.running ? "Stop run script" : "Run project script",
                  shortLabel: runStatus.running ? "Stop" : "Run",
                  onClick: runStatus.running
                    ? (onRunStop ?? (() => {}))
                    : (onRunStart ?? (() => {})),
                  disabled: runLoading,
                  active: runStatus.running,
                  activeClassName: "text-status-success",
                },
              ]
            : []),
          ...(transport.supportsLocalOperations
            ? [
                {
                  icon: <SquareTerminal />,
                  label: "Open in terminal",
                  shortLabel: "Terminal",
                  hotkeyLabel: "⇧T",
                  onClick: () => transport.call("open_in_terminal", { path: worktreePath }),
                },
                {
                  icon: <SquarePen />,
                  label: "Open in editor",
                  shortLabel: "Editor",
                  hotkeyLabel: "⇧E",
                  onClick: () => transport.call("open_in_editor", { path: worktreePath }),
                },
              ]
            : []),
        ]
      : []),
    // Chat — available without a worktree
    ...(!task.derived.is_archived && onOpenChat
      ? [
          {
            icon: <MessageSquare />,
            label: "Chat with Trak assistant",
            shortLabel: "Chat",
            hotkeyLabel: "⇧C",
            onClick: onOpenChat,
          },
        ]
      : []),
    // Stage override actions — only when the task is paused
    ...(canOverrideStage
      ? [
          {
            icon: <SkipForward />,
            label: "Skip stage",
            shortLabel: "Skip",
            onClick: () => setShowSkipStage(true),
          },
          {
            icon: <ArrowLeftRight />,
            label: "Change stage",
            shortLabel: "Change",
            onClick: () => setShowSendToStage(true),
          },
        ]
      : []),
    // Delete — always available
    {
      icon: <Trash2 />,
      label: "Delete Trak",
      shortLabel: "Delete",
      hotkeyLabel: "⇧D",
      onClick: () => setShowDeleteConfirm(true),
      destructive: true,
    },
  ];

  return (
    <>
      <SharedDrawerHeader
        title={task.title || task.description}
        onClose={onClose}
        actions={actions}
        escHidden={escHidden}
        expandable={{ taskId: task.id, description: task.description }}
      />

      {/* Pipeline row: session strip + subtask progress + pipeline bar */}
      <div className="shrink-0 px-6 py-2.5 border-b border-border flex items-center gap-3 min-w-0">
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
        className="inset-0 m-auto h-fit w-80"
      >
        <div className="bg-canvas border border-border rounded-panel shadow-lg p-5 flex flex-col gap-4">
          <div>
            <p className="text-forge-body-md font-semibold text-text-primary">Delete Trak?</p>
            <p className="mt-1 text-forge-body text-text-tertiary line-clamp-2">
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

      <SkipStageModal
        isOpen={showSkipStage}
        onClose={() => setShowSkipStage(false)}
        taskId={task.id}
        onSuccess={onClose}
        transport={transport}
      />

      <SendToStageModal
        isOpen={showSendToStage}
        onClose={() => setShowSendToStage(false)}
        taskId={task.id}
        onSuccess={onClose}
        transport={transport}
        stages={flowStages}
        currentStage={task.derived.current_stage ?? ""}
      />
    </>
  );
}
