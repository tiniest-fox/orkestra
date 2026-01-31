/**
 * Task card for the kanban board.
 */

import { AlertCircle, Eye, GitBranch, Layers, MessageCircle, XCircle, Zap } from "lucide-react";
import { useWorkflowConfig } from "../../providers/WorkflowConfigProvider";
import type { SubtaskProgress, WorkflowTaskView } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { Badge, buildStageColorMap, Panel, taskStateColors } from "../ui";

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
  const stageColors = buildStageColorMap(config);
  const { derived } = task;
  const isFailed = derived.is_failed;
  const isBlocked = derived.is_blocked;
  const isDone = derived.is_done;
  const hasActiveProcess = derived.is_working;
  const taskNeedsReview = derived.needs_review;
  const hasQuestions = derived.has_questions;
  const hasTitle = !!task.title;
  const isSubtask = variant === "subtask";

  const isSettingUp = task.phase === "setting_up";
  const showSpinner = hasActiveProcess && !taskNeedsReview && !hasQuestions;

  // Include subtask aggregate state in border highlights
  const effectiveQuestions = hasQuestions || (derived.subtask_progress?.has_questions ?? 0) > 0;
  const effectiveReview = taskNeedsReview || (derived.subtask_progress?.needs_review ?? 0) > 0;

  const borderClass = isFailed
    ? "border-error-300 bg-error-50 dark:border-error-700 dark:bg-error-950"
    : isBlocked
      ? "border-warning-300 bg-warning-50 dark:border-warning-700 dark:bg-warning-950"
      : effectiveQuestions
        ? "border-info-400 bg-info-50 dark:border-info-600 dark:bg-info-950"
        : effectiveReview
          ? "border-warning-400 bg-warning-50 dark:border-warning-600 dark:bg-warning-950"
          : isSelected
            ? "border-orange-500 ring-2 ring-orange-200 dark:ring-orange-800"
            : "";

  const errorText =
    task.status.type === "failed"
      ? task.status.error
      : task.status.type === "blocked"
        ? task.status.reason
        : undefined;

  return (
    <Panel as="button" autoFill={false} padded onClick={onClick} className={borderClass}>
      <div className="flex items-start justify-between gap-2">
        <h3
          className={`font-medium text-sm line-clamp-2 ${hasTitle ? "text-stone-800 dark:text-stone-100" : "text-stone-400 dark:text-stone-500"}`}
        >
          {isSubtask && task.short_id && (
            <span className="text-stone-400 dark:text-stone-500 font-mono font-normal mr-1.5">
              {task.short_id}
            </span>
          )}
          {getDisplayTitle(task)}
        </h3>
        <div className="flex items-center gap-1.5">
          {isSettingUp && (
            <span className="flex-shrink-0 p-1.5">
              <GitBranch className="w-4 h-4 text-stone-400 dark:text-stone-500 animate-spin-bounce" />
            </span>
          )}
          {task.auto_mode && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-purple-100 dark:bg-purple-900">
              <Zap
                className={`w-4 h-4 text-purple-600 dark:text-purple-300 ${showSpinner ? "animate-spin-bounce" : ""}`}
              />
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
          {showSpinner && !task.auto_mode && (
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
          {derived.is_waiting_on_children &&
            ((derived.subtask_progress?.has_questions ?? 0) > 0 ? (
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

      {task.description && hasTitle && (
        <p className="text-stone-500 dark:text-stone-400 text-xs mt-1 line-clamp-2">
          {task.description}
        </p>
      )}

      {isSubtask && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div>
            {isDone ? (
              <Badge variant="done">Done</Badge>
            ) : isFailed ? (
              <Badge variant="failed">Failed</Badge>
            ) : isBlocked ? (
              <Badge variant="blocked">Blocked</Badge>
            ) : derived.current_stage ? (
              <Badge colorClass={stageColors[derived.current_stage]?.badge}>
                {titleCase(derived.current_stage)}
              </Badge>
            ) : null}
          </div>
          {dependencyNames && dependencyNames.length > 0 && (
            <span className="text-stone-400 dark:text-stone-500 text-xs font-mono truncate">
              Depends on {dependencyNames.join(", ")}
            </span>
          )}
        </div>
      )}

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
    </Panel>
  );
}
