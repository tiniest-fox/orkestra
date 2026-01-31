/**
 * Subtasks tab - displays child tasks of a parent with progress summary.
 *
 * Receives subtask data from the shared TasksProvider via props.
 * Reuses TaskCard with "subtask" variant for consistent display.
 */

import type { SubtaskProgress, WorkflowTaskView } from "../../types/workflow";
import { TaskCard } from "../Kanban/TaskCard";

interface SubtasksTabProps {
  subtasks: WorkflowTaskView[];
  progress: SubtaskProgress;
  selectedSubtaskId?: string;
  onSelectSubtask?: (subtask: WorkflowTaskView) => void;
}

/** Per-state segment colors for the subtask progress bar. */
const progressSegments: { key: keyof SubtaskProgress; className: string }[] = [
  { key: "done", className: "bg-success-500 dark:bg-success-400" },
  { key: "working", className: "bg-orange-400 dark:bg-orange-500" },
  { key: "has_questions", className: "bg-info-400 dark:bg-info-500" },
  { key: "needs_review", className: "bg-warning-400 dark:bg-warning-500" },
  { key: "blocked", className: "bg-warning-300 dark:bg-warning-600" },
  { key: "failed", className: "bg-error-500 dark:bg-error-400" },
  { key: "waiting", className: "bg-stone-300 dark:bg-stone-600" },
];

function ProgressBar({ progress }: { progress: SubtaskProgress }) {
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-1">
        <span>
          {progress.done}/{progress.total} done
        </span>
        {progress.failed > 0 && (
          <span className="text-error-600 dark:text-error-400">{progress.failed} failed</span>
        )}
      </div>
      <div className="h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
        <div className="h-full flex">
          {progressSegments.map(
            ({ key, className }) =>
              progress[key] > 0 && (
                <div
                  key={key}
                  className={`${className} transition-all duration-300`}
                  style={{ width: `${(progress[key] / progress.total) * 100}%` }}
                />
              ),
          )}
        </div>
      </div>
    </div>
  );
}

export function SubtasksTab({
  subtasks,
  progress,
  selectedSubtaskId,
  onSelectSubtask,
}: SubtasksTabProps) {
  // Build id → short_id lookup for resolving dependency labels
  const shortIdById = new Map(subtasks.map((s) => [s.id, s.short_id ?? s.id]));

  return (
    <div className="p-4">
      <ProgressBar progress={progress} />

      {subtasks.length === 0 ? (
        <div className="text-stone-500 dark:text-stone-400 text-sm">No subtasks.</div>
      ) : (
        <div className="space-y-2">
          {subtasks.map((subtask) => (
            <TaskCard
              key={subtask.id}
              task={subtask}
              variant="subtask"
              isSelected={subtask.id === selectedSubtaskId}
              onClick={onSelectSubtask ? () => onSelectSubtask(subtask) : undefined}
              dependencyNames={(subtask.depends_on ?? [])
                .map((id) => shortIdById.get(id))
                .filter((name): name is string => !!name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
