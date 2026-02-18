/**
 * Task card for the kanban board.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CircleCheck,
  Eye,
  GitMerge,
  GitPullRequest,
  Hand,
  Layers,
  MessageCircle,
  Pause,
  XCircle,
  Zap,
} from "lucide-react";
import { usePrStatus } from "../../providers";
import { useWorkflowConfig } from "../../providers/WorkflowConfigProvider";
import type { SubtaskProgress, WorkflowTaskView } from "../../types/workflow";
import { Badge, Panel, taskStateColors } from "../ui";
import { IterationIndicator } from "./IterationIndicator";

interface TaskCardProps {
  task: WorkflowTaskView;
  onClick?: () => void;
  isSelected?: boolean;
  /** "board" (default) shows full card; "subtask" shows stage badge, hides ID/artifacts/subtask progress. */
  variant?: "board" | "subtask";
  /** Resolved dependency names (subtask variant only). */
  dependencyNames?: string[];
}

/** Per-state segment colors for the subtask progress bar. */
const progressSegments: { key: keyof SubtaskProgress; color: string }[] = [
  { key: "done", color: taskStateColors.done.bg },
  { key: "working", color: taskStateColors.working.bg },
  { key: "interrupted", color: taskStateColors.interrupted.bg },
  { key: "has_questions", color: taskStateColors.questions.bg },
  { key: "needs_review", color: taskStateColors.review.bg },
  { key: "blocked", color: taskStateColors.blocked.bg },
  { key: "failed", color: taskStateColors.failed.bg },
  { key: "waiting", color: taskStateColors.waiting.bg },
];

function SubtaskProgressBar({ progress }: { progress: SubtaskProgress }) {
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Layers className="w-3 h-3 text-stone-400 dark:text-stone-500" />
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {progress.done}/{progress.total} subtasks
        </span>
      </div>
      <div className="h-1 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
        <div className="h-full flex">
          {progressSegments.map(
            ({ key, color }) =>
              progress[key] > 0 && (
                <div
                  key={key}
                  className={`${color} transition-all duration-300`}
                  style={{ width: `${(progress[key] / progress.total) * 100}%` }}
                />
              ),
          )}
        </div>
      </div>
    </div>
  );
}

function getDisplayTitle(task: WorkflowTaskView): string {
  if (task.title) {
    return task.title;
  }
  const maxLength = 60;
  if (task.description.length <= maxLength) {
    return task.description;
  }
  return `${task.description.slice(0, maxLength)}...`;
}

export function TaskCard({
  task,
  onClick,
  isSelected,
  variant = "board",
  dependencyNames,
}: TaskCardProps) {
  const config = useWorkflowConfig();
  const { getPrStatus } = usePrStatus();
  const { derived } = task;

  // PR status for tasks with PR URLs
  const prStatus = task.pr_url ? getPrStatus(task.id) : undefined;
  const prIconColor = !task.pr_url
    ? null
    : !prStatus
      ? taskStateColors.pr_unknown.icon
      : prStatus.state === "open"
        ? taskStateColors.pr_open.icon
        : prStatus.state === "merged"
          ? taskStateColors.pr_merged.icon
          : taskStateColors.pr_closed.icon;

  // Build stage icons map from config
  const stageIcons: Record<string, string> = {};
  for (const stage of config.stages) {
    if (stage.icon) {
      stageIcons[stage.name] = stage.icon;
    }
  }
  // Integration is a hidden stage not in workflow.yaml, so we hardcode its icon
  stageIcons.integration = "git-pull-request-arrow";

  const isFailed = derived.is_failed;
  const isBlocked = derived.is_blocked;
  const isDone = derived.is_done;
  const isInterrupted = derived.is_interrupted;
  const hasActiveProcess = derived.is_working;
  const taskNeedsReview = derived.needs_review;
  const hasQuestions = derived.has_questions;
  const hasTitle = !!task.title;
  const isSubtask = variant === "subtask";
  const hasUnresolvedDeps = isSubtask && !!dependencyNames && dependencyNames.length > 0;
  const collapseDone = isSubtask && (isDone || derived.is_archived);

  const showSpinner = hasActiveProcess && !taskNeedsReview && !hasQuestions;

  // Include subtask aggregate state in border highlights
  const effectiveFailed = isFailed || (derived.subtask_progress?.failed ?? 0) > 0;
  const effectiveBlocked = isBlocked || (derived.subtask_progress?.blocked ?? 0) > 0;
  const effectiveInterrupted = isInterrupted || (derived.subtask_progress?.interrupted ?? 0) > 0;
  const effectiveQuestions = hasQuestions || (derived.subtask_progress?.has_questions ?? 0) > 0;
  const effectiveReview = taskNeedsReview || (derived.subtask_progress?.needs_review ?? 0) > 0;

  const borderClass = effectiveFailed
    ? "border-error-300 bg-error-50 dark:border-error-700 dark:bg-error-950"
    : effectiveBlocked
      ? "border-warning-300 bg-warning-50 dark:border-warning-700 dark:bg-warning-950"
      : effectiveInterrupted
        ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950"
        : effectiveQuestions
          ? "border-info-400 bg-info-50 dark:border-info-600 dark:bg-info-950"
          : effectiveReview
            ? "border-warning-400 bg-warning-50 dark:border-warning-600 dark:bg-warning-950"
            : isSelected
              ? "border-orange-500 ring-2 ring-orange-200 dark:ring-orange-800"
              : "";

  const errorText =
    task.state.type === "failed"
      ? task.state.error
      : task.state.type === "blocked"
        ? task.state.reason
        : undefined;

  return (
    <Panel
      as="button"
      autoFill={false}
      padded
      onClick={onClick}
      className={`${borderClass} shrink-0`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className={`font-medium text-sm line-clamp-2 ${collapseDone ? "text-stone-500 dark:text-stone-400" : hasTitle ? "text-stone-800 dark:text-stone-100" : "text-stone-400 dark:text-stone-500"}`}
        >
          {isSubtask && task.short_id && (
            <span className="text-stone-400 dark:text-stone-500 font-mono font-normal mr-1.5">
              {task.short_id}
            </span>
          )}
          {getDisplayTitle(task)}
        </h3>
        <div className="flex items-center gap-1.5">
          {/* Auto mode icon - subtle, no background. Excluded for Failed/Blocked (they show error icons) */}
          {task.auto_mode && !isFailed && !isBlocked && (
            <span className="flex-shrink-0 p-1.5">
              <Zap
                className={`w-4 h-4 ${taskStateColors.auto.icon} ${showSpinner || derived.is_system_active ? "animate-spin-bounce" : ""}`}
              />
            </span>
          )}
          {/* Git-related phase icon - only show when not in auto mode */}
          {derived.phase_icon === "git" && !task.auto_mode && (
            <span className="flex-shrink-0 p-1.5">
              <GitMerge className="w-4 h-4 text-stone-400 dark:text-stone-500 animate-spin-bounce" />
            </span>
          )}
          {/* Queued - work spinner - only show when not in auto mode */}
          {derived.phase_icon === "queued" && !task.auto_mode && (
            <span className="flex-shrink-0 p-1.5">
              <span className="block w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </span>
          )}
          {hasQuestions && (
            <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.questions.icon}`}>
              <MessageCircle className="w-4 h-4" />
            </span>
          )}
          {taskNeedsReview && !hasQuestions && (
            <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.review.icon}`}>
              <Eye className="w-4 h-4" />
            </span>
          )}
          {/* Work spinner for AgentWorking - only when not in auto mode and no phase_icon */}
          {showSpinner && !task.auto_mode && !derived.phase_icon && (
            <span className="flex-shrink-0 p-1.5">
              <span className="block w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </span>
          )}
          {isFailed && (
            <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.failed.icon}`}>
              <XCircle className="w-4 h-4" />
            </span>
          )}
          {isBlocked && (
            <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.blocked.icon}`}>
              <AlertCircle className="w-4 h-4" />
            </span>
          )}
          {isInterrupted && (
            <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.interrupted.icon}`}>
              <Pause className="w-4 h-4" />
            </span>
          )}
          {hasUnresolvedDeps && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-stone-100 dark:bg-stone-800">
              <Hand className="w-4 h-4 text-stone-500 dark:text-stone-400" />
            </span>
          )}
          {collapseDone && (
            <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.done.icon}`}>
              <CircleCheck className="w-4 h-4" />
            </span>
          )}
          {prIconColor && (
            <span className={`flex-shrink-0 p-1.5 rounded-md ${prIconColor}`}>
              <GitPullRequest className="w-4 h-4" />
            </span>
          )}
          {derived.is_waiting_on_children &&
            ((derived.subtask_progress?.failed ?? 0) > 0 ? (
              <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.failed.icon}`}>
                <XCircle className="w-4 h-4" />
              </span>
            ) : (derived.subtask_progress?.blocked ?? 0) > 0 ? (
              <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.blocked.icon}`}>
                <AlertCircle className="w-4 h-4" />
              </span>
            ) : (derived.subtask_progress?.interrupted ?? 0) > 0 ? (
              <span
                className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.interrupted.icon}`}
              >
                <Pause className="w-4 h-4" />
              </span>
            ) : (derived.subtask_progress?.has_questions ?? 0) > 0 ? (
              <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.questions.icon}`}>
                <MessageCircle className="w-4 h-4" />
              </span>
            ) : (derived.subtask_progress?.needs_review ?? 0) > 0 ? (
              <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.review.icon}`}>
                <Eye className="w-4 h-4" />
              </span>
            ) : (
              <span className={`flex-shrink-0 p-1.5 rounded-md ${taskStateColors.waiting.icon}`}>
                <Layers
                  className={`w-4 h-4 ${(derived.subtask_progress?.working ?? 0) > 0 ? "animate-spin-bounce" : ""}`}
                />
              </span>
            ))}
        </div>
      </div>

      {/* Board variant: description always visible */}
      {!isSubtask && task.description && hasTitle && (
        <p className="text-stone-500 dark:text-stone-400 text-xs mt-1 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Subtask variant: description + stage row collapse when done */}
      <AnimatePresence initial={false}>
        {isSubtask && !isDone && !derived.is_archived && (
          <motion.div
            key="subtask-details"
            initial={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            {task.description && hasTitle && (
              <p className="text-stone-500 dark:text-stone-400 text-xs mt-1 line-clamp-2">
                {task.description}
              </p>
            )}
            {(isFailed || isBlocked || (dependencyNames && dependencyNames.length > 0)) && (
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <div>
                  {isFailed ? (
                    <Badge variant="failed">Failed</Badge>
                  ) : isBlocked ? (
                    <Badge variant="blocked">Blocked</Badge>
                  ) : null}
                </div>
                {dependencyNames && dependencyNames.length > 0 && (
                  <span className="text-stone-400 dark:text-stone-500 text-xs font-mono truncate">
                    Depends on {dependencyNames.join(", ")}
                  </span>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!isSubtask && derived.subtask_progress && (
        <SubtaskProgressBar progress={derived.subtask_progress} />
      )}

      {!isSubtask && (
        <span className="text-stone-400 dark:text-stone-500 text-xs font-mono mt-2.5">
          {task.id}
        </span>
      )}

      {errorText && (isFailed || isBlocked) && (
        <p
          className={`text-xs mt-2 p-2 rounded-panel-sm ${
            isFailed
              ? "text-error-700 bg-error-100 dark:text-error-300 dark:bg-error-900"
              : "text-warning-700 bg-warning-100 dark:text-warning-300 dark:bg-warning-900"
          }`}
        >
          {isFailed ? errorText : `Blocked: ${errorText}`}
        </p>
      )}

      {!isSubtask && isDone && Object.keys(task.artifacts ?? {}).length > 0 && (
        <div className="text-stone-500 dark:text-stone-400 text-xs mt-2">
          {Object.keys(task.artifacts ?? {}).length} artifact(s)
        </div>
      )}

      <IterationIndicator
        iterations={task.iterations}
        stageIcons={stageIcons}
        isActive={hasActiveProcess}
      />
    </Panel>
  );
}
