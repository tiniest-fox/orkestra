//! Sticky section header with task rows for one feed section.

import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import type { FeedSection as FeedSectionData } from "../../utils/feedGrouping";
import { FeedSubtaskRow } from "./FeedSubtaskRow";
import { FeedTaskRow } from "./FeedTaskRow";

interface FeedSectionProps {
  section: FeedSectionData;
  surfacedSubtasks?: WorkflowTaskView[];
  config: WorkflowConfig;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
  onReview: (taskId: string) => void;
  onAnswer: (taskId: string) => void;
  onMerge?: (taskId: string) => void;
  onOpenPr?: (taskId: string) => void;
  onArchive?: (taskId: string) => void;
  onRowClick?: (taskId: string) => void;
}

export function FeedSection({
  section,
  surfacedSubtasks,
  config,
  focusedId,
  onFocusRow,
  onReview,
  onAnswer,
  onMerge,
  onOpenPr,
  onArchive,
  onRowClick,
}: FeedSectionProps) {
  const subtasks = surfacedSubtasks ?? [];
  const selfCount = section.tasks.filter(
    (t) => t.derived.needs_review || t.derived.has_questions || t.derived.is_failed,
  ).length;
  const totalCount =
    section.name === "needs_review" ? selfCount + subtasks.length : section.tasks.length + subtasks.length;

  if (totalCount === 0) return null;

  return (
    <div>
      <div className="sticky top-0 z-10 px-6 pt-4 bg-[var(--canvas)]">
        <div className="flex items-baseline gap-2">
          <span className="font-forge-mono text-[10px] font-semibold tracking-[0.10em] uppercase text-[var(--accent)]">
            {section.label}
          </span>
          <span className="font-forge-mono text-[10px] font-medium text-[var(--text-3)]">{totalCount}</span>
        </div>
        <div className="border-b mt-3 mx-0 border-[var(--border)]" />
      </div>
      <div>
        {section.tasks.map((task) => {
          const taskSubtasks = subtasks.filter((s) => s.parent_id === task.id);
          return (
            <div key={task.id}>
              <FeedTaskRow
                task={task}
                config={config}
                isFocused={focusedId === task.id}
                onMouseEnter={() => onFocusRow(task.id)}
                onReview={() => onReview(task.id)}
                onAnswer={() => onAnswer(task.id)}
                onMerge={onMerge ? () => onMerge(task.id) : undefined}
                onOpenPr={onOpenPr ? () => onOpenPr(task.id) : undefined}
                onArchive={onArchive ? () => onArchive(task.id) : undefined}
                onClick={onRowClick ? () => onRowClick(task.id) : undefined}
              />
              {taskSubtasks.map((subtask) => (
                <FeedSubtaskRow
                  key={subtask.id}
                  subtask={subtask}
                  config={config}
                  isFocused={focusedId === subtask.id}
                  onMouseEnter={() => onFocusRow(subtask.id)}
                  onReview={() => onReview(subtask.id)}
                  onAnswer={() => onAnswer(subtask.id)}
                  onMerge={onMerge ? () => onMerge(subtask.id) : undefined}
                  onOpenPr={onOpenPr ? () => onOpenPr(subtask.id) : undefined}
                  onArchive={onArchive ? () => onArchive(subtask.id) : undefined}
                  onClick={onRowClick ? () => onRowClick(subtask.id) : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
