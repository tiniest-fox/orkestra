/**
 * Subtasks tab - displays child tasks of a parent with progress summary.
 *
 * Receives subtask data from the shared TasksProvider via props.
 * Reuses TaskCard with "subtask" variant for consistent display.
 */

import type { SubtaskProgress, WorkflowTaskView } from "../../types/workflow";
import { TaskCard } from "../Kanban/TaskCard";
import { taskStateColors } from "../ui";

interface SubtasksTabProps {
  subtasks: WorkflowTaskView[];
  progress: SubtaskProgress;
  selectedSubtaskId?: string;
  onSelectSubtask?: (subtask: WorkflowTaskView) => void;
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

function ProgressBar({ progress }: { progress: SubtaskProgress }) {
  return (
    <>
      <div className="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-1">
        <span>
          {progress.done}/{progress.total} done
        </span>
        {progress.failed > 0 && <span className="text-error-600 dark:text-error-400">{progress.failed} failed</span>}
      </div>
      <div className="h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden mb-4">
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
    </>
  );
}

export function SubtasksTab({ subtasks, progress, selectedSubtaskId, onSelectSubtask }: SubtasksTabProps) {
  // Build id → short_id lookup for resolving dependency labels
  const shortIdById = new Map(subtasks.map((s) => [s.id, s.short_id ?? s.id]));
  // Track which subtasks are done so we only show unresolved dependencies
  const doneIds = new Set(subtasks.filter((s) => s.derived.is_done).map((s) => s.id));
  // Stable partition: incomplete first, done second (preserves topological order within each group)
  const sorted = [...subtasks.filter((s) => !s.derived.is_done), ...subtasks.filter((s) => s.derived.is_done)];

  return (
    <div className="p-4">
      <ProgressBar progress={progress} />

      {subtasks.length === 0 ? (
        <div className="text-stone-500 dark:text-stone-400 text-sm">No subtasks.</div>
      ) : (
        <div className="space-y-2 flex flex-col items-stretch">
          {sorted.map((subtask) => (
            <TaskCard
              key={subtask.id}
              task={subtask}
              variant="subtask"
              isSelected={subtask.id === selectedSubtaskId}
              onClick={onSelectSubtask ? () => onSelectSubtask(subtask) : undefined}
              dependencyNames={(subtask.depends_on ?? [])
                .filter((id) => !doneIds.has(id))
                .map((id) => shortIdById.get(id))
                .filter((name): name is string => !!name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
