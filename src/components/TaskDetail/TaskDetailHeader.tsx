/**
 * Task detail header - title, status badges, and close button.
 */

import type { WorkflowTask } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { Badge, Panel } from "../ui";

interface TaskDetailHeaderProps {
  task: WorkflowTask;
  hasQuestions: boolean;
  needsReview: boolean;
  onClose: () => void;
}

export function TaskDetailHeader({
  task,
  hasQuestions,
  needsReview,
  onClose,
}: TaskDetailHeaderProps) {
  const statusBadgeVariant =
    task.status.type === "done"
      ? "success"
      : task.status.type === "failed"
        ? "error"
        : task.status.type === "blocked"
          ? "blocked"
          : "neutral";

  const statusLabel =
    task.status.type === "active"
      ? titleCase(task.status.stage)
      : task.status.type === "waiting_on_children"
        ? "Waiting"
        : titleCase(task.status.type);

  return (
    <div className="flex flex-col items-stretch pt-1 pb-2 px-2">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-heading font-semibold text-lg text-stone-800 line-clamp-1">
          {task.title}
        </h2>
        <Panel.CloseButton onClick={onClose} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm text-stone-500">{task.id}</span>
        <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
        {hasQuestions && <Badge variant="info">Questions</Badge>}
        {needsReview && <Badge variant="warning">Review</Badge>}
      </div>
    </div>
  );
}
