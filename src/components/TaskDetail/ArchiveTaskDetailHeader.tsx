/**
 * Archive task detail header - simplified read-only version without action buttons.
 */

import type { WorkflowTask } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { Badge, Panel } from "../ui";

interface ArchiveTaskDetailHeaderProps {
  task: WorkflowTask;
  onClose: () => void;
}

export function ArchiveTaskDetailHeader({ task, onClose }: ArchiveTaskDetailHeaderProps) {
  const statusBadgeVariant =
    task.state.type === "done"
      ? "done"
      : task.state.type === "failed"
        ? "failed"
        : task.state.type === "blocked"
          ? "blocked"
          : "waiting";

  const statusLabel =
    task.state.type === "waiting_on_children"
      ? "Waiting"
      : "stage" in task.state
        ? titleCase(task.state.stage)
        : titleCase(task.state.type);

  return (
    <div className="flex flex-col items-stretch pt-1 pb-2 px-2">
      <div className="flex items-start justify-between gap-2">
        <h2
          className={`font-heading font-semibold text-lg line-clamp-1 ${task.title ? "text-stone-800 dark:text-stone-100" : "text-stone-400 dark:text-stone-500"}`}
        >
          {task.title || task.description}
        </h2>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Panel.CloseButton onClick={onClose} />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm text-stone-500 dark:text-stone-400">{task.id}</span>
        <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
      </div>
    </div>
  );
}
