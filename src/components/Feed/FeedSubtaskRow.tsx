//! Indented row for surfaced subtasks in the Needs Review section.

import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { FeedRow } from "./FeedRow";

interface FeedSubtaskRowProps {
  subtask: WorkflowTaskView;
  parentTitle: string;
  config: WorkflowConfig;
}

export function FeedSubtaskRow({ subtask, parentTitle, config }: FeedSubtaskRowProps) {
  const displayId = subtask.short_id ?? subtask.id;

  return (
    <FeedRow
      task={subtask}
      config={config}
      paddingClass="pl-[44px] pr-6"
      subtitle={`${parentTitle} · ${displayId}`}
    />
  );
}
