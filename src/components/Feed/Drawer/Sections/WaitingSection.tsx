//! Section showing waiting-on-children tasks with their blocking dependency labels.

import { useIsMobile } from "../../../../hooks/useIsMobile";
import type { WorkflowConfig, WorkflowTaskView } from "../../../../types/workflow";
import { FeedTaskRow } from "../../FeedTaskRow";

// ============================================================================
// Types
// ============================================================================

interface WaitingSectionProps {
  tasks: WorkflowTaskView[];
  allTasks: WorkflowTaskView[];
  config: WorkflowConfig;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
  onAction: (id: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function WaitingSection({
  tasks,
  allTasks,
  config,
  focusedId,
  onFocusRow,
  onAction,
}: WaitingSectionProps) {
  const isMobile = useIsMobile();
  if (tasks.length === 0) return null;

  return (
    <div>
      <div className={`sticky top-0 z-10 ${isMobile ? "px-2" : "px-6"} pt-4 bg-canvas`}>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.10em] uppercase text-accent">
            WAITING
          </span>
          <span className="font-mono text-[10px] font-medium text-text-quaternary">
            {tasks.length}
          </span>
        </div>
        <div className="border-b mt-3 border-border" />
      </div>
      <div>
        {tasks.map((task) => {
          const blockingDeps = (task.depends_on ?? [])
            .map((depId) => allTasks.find((t) => t.id === depId))
            .filter(
              (dep): dep is WorkflowTaskView =>
                dep !== undefined && !dep.derived.is_done && !dep.derived.is_archived,
            );

          const blockedReason = task.state.type === "blocked" ? task.state.reason : undefined;

          const actionsSlot =
            blockingDeps.length > 0 ? (
              <div className="flex items-center justify-end gap-1 w-full">
                <span className="font-mono text-[10px] text-text-quaternary">after</span>
                {blockingDeps.map((dep, i) => (
                  <span key={dep.id} className="flex items-center gap-1">
                    {i > 0 && <span className="font-mono text-[10px] text-text-quaternary">·</span>}
                    <span className="font-mono text-[10px] text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded">
                      {dep.short_id ?? dep.id.split("-").pop()}
                    </span>
                  </span>
                ))}
              </div>
            ) : blockedReason ? (
              <div className="flex items-center justify-end w-full">
                <span className="font-mono text-[10px] text-text-quaternary truncate">
                  {blockedReason}
                </span>
              </div>
            ) : null;

          return (
            <FeedTaskRow
              key={task.id}
              task={task}
              config={config}
              isFocused={focusedId === task.id}
              waiting
              onMouseEnter={() => onFocusRow(task.id)}
              onReview={() => onAction(task.id)}
              onAnswer={() => onAction(task.id)}
              onApprove={() => onAction(task.id)}
              onMerge={() => onAction(task.id)}
              onOpenPr={() => onAction(task.id)}
              onClick={() => onAction(task.id)}
              actionsSlot={actionsSlot}
            />
          );
        })}
      </div>
    </div>
  );
}
