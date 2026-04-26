// 4-column grid row for a top-level task in the feed view.

import React from "react";
import type { PrStatus, WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { FeedRow } from "./FeedRow";
import { IterationChain } from "./IterationChain";

interface FeedTaskRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  isFocused: boolean;
  /** When true, shows a waiting indicator instead of the task's derived status symbol. */
  waiting?: boolean;
  prStatus?: PrStatus;
  onMouseEnter: () => void;
  onReview: () => void;
  onAnswer: () => void;
  onApprove: () => void;
  onMerge?: () => void;
  onOpenPr?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  actionsSlot?: React.ReactNode;
}

function FeedTaskRowInner({
  task,
  config,
  isFocused,
  waiting,
  prStatus,
  onMouseEnter,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
  onArchive,
  onDelete,
  onClick,
  actionsSlot,
}: FeedTaskRowProps) {
  const isCompleted = task.derived.is_archived;

  return (
    <FeedRow
      task={task}
      config={config}
      subtitle={<IterationChain iterations={task.iterations} />}
      faded={isCompleted}
      isFocused={isFocused}
      waiting={waiting}
      prStatus={prStatus}
      onMouseEnter={onMouseEnter}
      onReview={onReview}
      onAnswer={onAnswer}
      onApprove={onApprove}
      onMerge={onMerge}
      onOpenPr={onOpenPr}
      onArchive={onArchive}
      onDelete={onDelete}
      onClick={onClick}
      actionsSlot={actionsSlot}
    />
  );
}

// Memoize to skip re-renders when only callback props change reference.
// Task data comparison uses updated_at — bumped by touch_task whenever
// iterations or sessions change, so this is a safe equality proxy.
//
// `actionsSlot` is intentionally omitted from the comparator: React.ReactNode
// references are new objects on every parent render, so comparing them would
// always return false and defeat memoization. Safety: actionsSlot content is
// derived from task state (captured by updated_at) and focus state (captured
// by isFocused), so any visible change to actionsSlot is already reflected in
// one of those props.
//
// `onClick` is intentionally omitted: callers always pass
// `() => onRowClick(task.id)` where `task.id` is immutable. A stale reference
// still navigates to the same task, so skipping re-renders is safe here.
// The other action callbacks (onReview, onAnswer, etc.) are omitted for the
// same reason — they are all closures over a stable task.id.
export const FeedTaskRow = React.memo(FeedTaskRowInner, (prev, next) => {
  return (
    prev.task.updated_at === next.task.updated_at &&
    prev.isFocused === next.isFocused &&
    prev.waiting === next.waiting &&
    prev.config === next.config &&
    prev.prStatus === next.prStatus
  );
});
