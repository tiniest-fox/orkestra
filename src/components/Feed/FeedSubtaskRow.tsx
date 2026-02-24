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
  onMerge?: () => void;
  onOpenPr?: () => void;
  onClick?: () => void;
}

export function FeedSubtaskRow({
  subtask,
  config,
  isFocused,
  onMouseEnter,
  onReview,
  onAnswer,
  onMerge,
  onOpenPr,
  onClick,
}: FeedSubtaskRowProps) {
  return (
    <FeedRow
      task={subtask}
      config={config}
      paddingClass="px-6"
      subtitle={<IterationChain iterations={subtask.iterations} />}
      isSubtask
      isFocused={isFocused}
      onMouseEnter={onMouseEnter}
      onReview={onReview}
      onAnswer={onAnswer}
      onMerge={onMerge}
      onOpenPr={onOpenPr}
      onClick={onClick}
    />
  );
}
