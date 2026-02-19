//! Sticky section header with task rows for one feed section.

import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import type { FeedSection as FeedSectionData } from "../../utils/feedGrouping";
import { FeedSubtaskRow } from "./FeedSubtaskRow";
import { FeedTaskRow } from "./FeedTaskRow";

interface FeedSectionProps {
  section: FeedSectionData;
  surfacedSubtasks?: WorkflowTaskView[];
  parentTitleById: Record<string, string>;
  config: WorkflowConfig;
}

export function FeedSection({
  section,
  surfacedSubtasks,
  parentTitleById,
  config,
}: FeedSectionProps) {
  const subtasks = surfacedSubtasks ?? [];
  const totalCount = section.tasks.length + subtasks.length;

  if (totalCount === 0) return null;

  return (
    <div>
      <div className="sticky top-0 z-10 px-6 pt-4 bg-[var(--canvas)]">
        <div className="flex items-baseline gap-2">
          <span className="font-forge-mono text-[10px] font-semibold tracking-[0.10em] uppercase text-[var(--accent)]">
            {section.label}
          </span>
          <span className="font-forge-mono text-[10px] text-[var(--text-3)]">{totalCount}</span>
        </div>
        <div className="border-b mt-3 mx-0 border-[var(--border)]" />
      </div>
      <div>
        {section.tasks.map((task) => (
          <FeedTaskRow key={task.id} task={task} config={config} />
        ))}
        {subtasks.map((subtask) => (
          <FeedSubtaskRow
            key={subtask.id}
            subtask={subtask}
            parentTitle={parentTitleById[subtask.parent_id ?? ""] ?? subtask.parent_id ?? ""}
            config={config}
          />
        ))}
      </div>
    </div>
  );
}
