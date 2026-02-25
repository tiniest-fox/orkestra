//! 4-column grid row for a top-level task in the feed view.

import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { FeedRow } from "./FeedRow";
import { IterationChain } from "./IterationChain";

interface FeedTaskRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  isFocused: boolean;
  onMouseEnter: () => void;
  onReview: () => void;
  onAnswer: () => void;
  onApprove: () => void;
  onMerge?: () => void;
  onOpenPr?: () => void;
  onClick?: () => void;
  actionsSlot?: React.ReactNode;
}

export function FeedTaskRow({
  task,
  config,
  isFocused,
  onMouseEnter,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
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
      onMouseEnter={onMouseEnter}
      onReview={onReview}
      onAnswer={onAnswer}
      onApprove={onApprove}
      onMerge={onMerge}
      onOpenPr={onOpenPr}
      onClick={onClick}
      actionsSlot={actionsSlot}
    />
  );
}
