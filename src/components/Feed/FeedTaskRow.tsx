//! 4-column grid row for a top-level task in the feed view.

import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { FeedRow } from "./FeedRow";
import { IterationChain } from "./IterationChain";
import { SubtaskProgressBar } from "./SubtaskProgressBar";

interface FeedTaskRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  isFocused: boolean;
  onMouseEnter: () => void;
  onReview: () => void;
  onAnswer: () => void;
  onMerge?: () => void;
  onOpenPr?: () => void;
  onArchive?: () => void;
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
      subtitle={
        task.derived.subtask_progress ? (
          <SubtaskProgressBar progress={task.derived.subtask_progress} />
        ) : (
          <IterationChain iterations={task.iterations} />
        )
      }
      faded={isCompleted}
      isFocused={isFocused}
      onMouseEnter={onMouseEnter}
      onReview={onReview}
      onAnswer={onAnswer}
      onMerge={onMerge}
      onOpenPr={onOpenPr}
      onArchive={onArchive}
      onClick={onClick}
      actionsSlot={actionsSlot}
    />
  );
}
