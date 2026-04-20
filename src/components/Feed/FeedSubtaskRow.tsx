//! Indented row for surfaced subtasks in the Needs Review section.

import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { FeedRow } from "./FeedRow";
import { IterationChain } from "./IterationChain";

interface FeedSubtaskRowProps {
  subtask: WorkflowTaskView;
  config: WorkflowConfig;
  isFocused: boolean;
  onMouseEnter: () => void;
  onReview: () => void;
  onAnswer: () => void;
  onApprove: () => void;
  onMerge?: () => void;
  onOpenPr?: () => void;
  onArchive?: () => void;
  onClick?: () => void;
}

export function FeedSubtaskRow({
  subtask,
  config,
  isFocused,
  onMouseEnter,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
  onArchive,
  onClick,
}: FeedSubtaskRowProps) {
  return (
    <FeedRow
      task={subtask}
      config={config}
      subtitle={<IterationChain iterations={subtask.iterations} />}
      isSubtask
      isFocused={isFocused}
      onMouseEnter={onMouseEnter}
      onReview={onReview}
      onAnswer={onAnswer}
      onApprove={onApprove}
      onMerge={onMerge}
      onOpenPr={onOpenPr}
      onArchive={onArchive}
      onClick={onClick}
    />
  );
}
