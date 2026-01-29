/**
 * Task detail header - title, status badges, close button, and delete action.
 */

import { useState } from "react";
import type { WorkflowTask } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { Badge, Button, IconButton, Panel } from "../ui";

interface TaskDetailHeaderProps {
  task: WorkflowTask;
  hasQuestions: boolean;
  needsReview: boolean;
  onClose: () => void;
  onDelete: () => void;
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

export function TaskDetailHeader({
  task,
  hasQuestions,
  needsReview,
  onClose,
  onDelete,
}: TaskDetailHeaderProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const statusBadgeVariant =
    task.status.type === "done"
      ? "success"
      : task.status.type === "failed"
        ? "error"
        : task.status.type === "blocked"
          ? "warning"
          : "neutral";

  const statusLabel =
    task.status.type === "active"
      ? titleCase(task.status.stage)
      : task.status.type === "waiting_on_children"
        ? "Waiting"
        : titleCase(task.status.type);

  const handleDeleteClick = () => {
    setConfirmingDelete(true);
  };

  const handleConfirmDelete = () => {
    setConfirmingDelete(false);
    onDelete();
  };

  const handleCancelDelete = () => {
    setConfirmingDelete(false);
  };

  return (
    <div className="flex flex-col items-stretch pt-1 pb-2 px-2">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-heading font-semibold text-lg text-stone-800 line-clamp-1">
          {task.title}
        </h2>
        <div className="flex items-center gap-1 flex-shrink-0">
          <IconButton
            icon={<TrashIcon />}
            aria-label="Delete task"
            variant="ghost"
            size="sm"
            onClick={handleDeleteClick}
          />
          <Panel.CloseButton onClick={onClose} />
        </div>
      </div>

      {confirmingDelete ? (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-stone-600">Delete task? This cannot be undone.</span>
          <Button variant="destructive" size="sm" onClick={handleConfirmDelete}>
            Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCancelDelete}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm text-stone-500">{task.id}</span>
          <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
          {hasQuestions && <Badge variant="info">Questions</Badge>}
          {needsReview && <Badge variant="warning">Review</Badge>}
        </div>
      )}
    </div>
  );
}
