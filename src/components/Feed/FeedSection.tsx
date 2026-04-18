// Sticky section header with task rows for one feed section.

import { useIsMobile } from "../../hooks/useIsMobile";
import type { PrStatus, WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import type { FeedSection as FeedSectionData } from "../../utils/feedGrouping";
import { FeedSubtaskRow } from "./FeedSubtaskRow";
import { FeedTaskRow } from "./FeedTaskRow";

interface FeedSectionProps {
  section: FeedSectionData;
  surfacedSubtasks?: WorkflowTaskView[];
  config: WorkflowConfig;
  focusedId: string | null;
  getPrStatus?: (taskId: string) => PrStatus | undefined;
  onFocusRow: (id: string) => void;
  onReview: (taskId: string) => void;
  onAnswer: (taskId: string) => void;
  onApprove: (taskId: string) => void;
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
  getPrStatus,
  onFocusRow,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
  onArchive,
  onRowClick,
}: FeedSectionProps) {
  const isMobile = useIsMobile();
  const subtasks = surfacedSubtasks ?? [];
  const totalCount = section.tasks.length;

  if (totalCount === 0) return null;

  return (
    <div>
      <div
        className={`sticky top-0 z-10 ${isMobile ? "px-2" : "px-6"} ${isMobile ? "pt-3" : "pt-4"} bg-canvas`}
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.10em] uppercase text-accent">
            {section.label}
          </span>
          <span className="font-mono text-[10px] font-medium text-text-quaternary">
            {totalCount}
          </span>
        </div>
        <div className={`border-b ${isMobile ? "mt-2" : "mt-3"} mx-0 border-border`} />
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
                prStatus={getPrStatus?.(task.id)}
                onMouseEnter={() => onFocusRow(task.id)}
                onReview={() => onReview(task.id)}
                onAnswer={() => onAnswer(task.id)}
                onApprove={() => onApprove(task.id)}
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
                  onApprove={() => onApprove(subtask.id)}
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
