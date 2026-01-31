/**
 * Task detail header - title, status badges, close button, and delete action.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { WorkflowTask } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { Badge, IconButton, Panel } from "../ui";

interface TaskDetailHeaderProps {
  task: WorkflowTask;
  hasQuestions: boolean;
  needsReview: boolean;
  onClose: () => void;
  onRequestDelete: () => void;
  onToggleAutoMode: (autoMode: boolean) => void;
}

interface DetectedApp {
  name: string;
  id: string;
}

interface ExternalToolsInfo {
  terminal: DetectedApp | null;
  editor: DetectedApp | null;
}

function TrashIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>
  );
}

/** Cache external tools detection result across renders. */
let cachedToolsInfo: ExternalToolsInfo | null = null;
let toolsDetectionPromise: Promise<ExternalToolsInfo> | null = null;

function detectTools(): Promise<ExternalToolsInfo> {
  if (cachedToolsInfo) {
    return Promise.resolve(cachedToolsInfo);
  }
  if (!toolsDetectionPromise) {
    toolsDetectionPromise = invoke<ExternalToolsInfo>("detect_external_tools").then((info) => {
      cachedToolsInfo = info;
      return info;
    });
  }
  return toolsDetectionPromise;
}

// Pre-warm: start detection at module load so the cache is ready
// before any TaskDetailHeader mounts.
detectTools().catch(() => {});

export function TaskDetailHeader({
  task,
  hasQuestions,
  needsReview,
  onClose,
  onRequestDelete,
  onToggleAutoMode,
}: TaskDetailHeaderProps) {
  const [toolsInfo, setToolsInfo] = useState<ExternalToolsInfo | null>(cachedToolsInfo);

  useEffect(() => {
    detectTools()
      .then(setToolsInfo)
      .catch((err) => console.error("Failed to detect external tools:", err));
  }, []);

  const isSubtask = !!task.parent_id;
  const hasWorktree = !!task.worktree_path;
  const showTerminalButton = !isSubtask && hasWorktree && toolsInfo?.terminal != null;
  const showEditorButton = !isSubtask && hasWorktree && toolsInfo?.editor != null;

  const handleOpenTerminal = () => {
    if (!task.worktree_path) return;
    invoke("open_in_terminal", { path: task.worktree_path }).catch((err) =>
      console.error("Failed to open terminal:", err),
    );
  };

  const handleOpenEditor = () => {
    if (!task.worktree_path) return;
    invoke("open_in_editor", { path: task.worktree_path }).catch((err) =>
      console.error("Failed to open editor:", err),
    );
  };

  const statusBadgeVariant =
    task.status.type === "done"
      ? "done"
      : task.status.type === "failed"
        ? "failed"
        : task.status.type === "blocked"
          ? "blocked"
          : "waiting";

  const statusLabel =
    task.status.type === "active"
      ? titleCase(task.status.stage)
      : task.status.type === "waiting_on_children"
        ? "Waiting"
        : titleCase(task.status.type);

  return (
    <div className="flex flex-col items-stretch pt-1 pb-2 px-2">
      <div className="flex items-start justify-between gap-2">
        <h2
          className={`font-heading font-semibold text-lg line-clamp-1 ${task.title ? "text-stone-800 dark:text-stone-100" : "text-stone-400 dark:text-stone-500"}`}
        >
          {task.title || task.description}
        </h2>
        <div className="flex items-center gap-1 flex-shrink-0">
          {showTerminalButton && (
            <IconButton
              icon={<TerminalIcon />}
              aria-label={`Open in ${toolsInfo.terminal?.name}`}
              variant="ghost"
              size="sm"
              onClick={handleOpenTerminal}
              title={`Open in ${toolsInfo.terminal?.name}`}
            />
          )}
          {showEditorButton && (
            <IconButton
              icon={<CodeIcon />}
              aria-label={`Open in ${toolsInfo.editor?.name}`}
              variant="ghost"
              size="sm"
              onClick={handleOpenEditor}
              title={`Open in ${toolsInfo.editor?.name}`}
            />
          )}
          {!isSubtask && (
            <IconButton
              icon={<TrashIcon />}
              aria-label="Delete task"
              variant="ghost"
              size="sm"
              onClick={onRequestDelete}
            />
          )}
          <Panel.CloseButton onClick={onClose} />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm text-stone-500 dark:text-stone-400">{task.id}</span>
        <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
        {hasQuestions && <Badge variant="questions">Questions</Badge>}
        {needsReview && <Badge variant="review">Review</Badge>}

        <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={task.auto_mode}
            onClick={() => onToggleAutoMode(!task.auto_mode)}
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
              task.auto_mode ? "bg-purple-500" : "bg-stone-300 dark:bg-stone-600"
            }`}
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform ${
                task.auto_mode ? "translate-x-[14px]" : "translate-x-[3px]"
              }`}
            />
          </button>
          <span className="text-xs text-stone-500 dark:text-stone-400">Auto</span>
        </label>
      </div>
    </div>
  );
}
