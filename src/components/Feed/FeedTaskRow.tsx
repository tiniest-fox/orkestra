// 4-column grid row for a top-level task in the feed view.

import React from "react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { FeedRow } from "./FeedRow";
import { IterationChain } from "./IterationChain";

interface FeedTaskRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  isFocused: boolean;
  /** When true, shows a waiting indicator instead of the task's derived status symbol. */
  waiting?: boolean;
  onMouseEnter: () => void;
  onReview: () => void;
  onAnswer: () => void;
  onApprove: () => void;
  onMerge?: () => void;
  onOpenPr?: () => void;
  onArchive?: () => void;
  onClick?: () => void;
  actionsSlot?: React.ReactNode;
}

function FeedTaskRowInner({
  task,
  config,
  isFocused,
  waiting,
  onMouseEnter,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
  onArchive,
  onClick,
  actionsSlot,
}: FeedTaskRowProps) {
  const isCompleted = task.derived.is_archived;

  return (
    <FeedRow
      task={task}
      config={config}
      paddingClass="px-6"
      subtitle={<IterationChain iterations={task.iterations} />}
      faded={isCompleted}
      isFocused={isFocused}
      waiting={waiting}
      onMouseEnter={onMouseEnter}
      onReview={onReview}
      onAnswer={onAnswer}
      onApprove={onApprove}
      onMerge={onMerge}
      onOpenPr={onOpenPr}
      onArchive={onArchive}
      onClick={onClick}
      actionsSlot={actionsSlot}
    />
  );
}

// Memoize to skip re-renders when only callback props change reference.
// Task data comparison uses updated_at — bumped by touch_task whenever
// iterations or sessions change, so this is a safe equality proxy.
export const FeedTaskRow = React.memo(FeedTaskRowInner, (prev, next) => {
  return (
    prev.task.updated_at === next.task.updated_at &&
    prev.isFocused === next.isFocused &&
    prev.waiting === next.waiting &&
    prev.config === next.config
  );
});
