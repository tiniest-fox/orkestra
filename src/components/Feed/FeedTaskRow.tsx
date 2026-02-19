//! 4-column grid row for a top-level task in the feed view.

import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { FeedRow } from "./FeedRow";

interface FeedTaskRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
}

export function FeedTaskRow({ task, config }: FeedTaskRowProps) {
  const isCompleted = task.derived.is_done || task.derived.is_archived;

  return (
    <FeedRow
      task={task}
      config={config}
      paddingClass="px-6"
      subtitle={task.id}
      faded={isCompleted}
    />
  );
}
