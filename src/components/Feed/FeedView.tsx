//! Feed view displaying tasks grouped by intent with pipeline bars and status symbols.

import { useMemo } from "react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { groupTasksForFeed } from "../../utils/feedGrouping";
import { FeedSection } from "./FeedSection";

interface FeedViewProps {
  config: WorkflowConfig;
  tasks: WorkflowTaskView[];
}

export function FeedView({ config, tasks }: FeedViewProps) {
  const { sections, surfacedSubtasks } = useMemo(() => groupTasksForFeed(tasks), [tasks]);

  const parentTitleById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const task of tasks) {
      map[task.id] = task.title;
    }
    return map;
  }, [tasks]);

  const isEmpty = sections.every((s) => s.tasks.length === 0) && surfacedSubtasks.length === 0;

  return (
    <div className="forge-theme h-full overflow-y-auto rounded-panel">
      {sections.map((section) => (
        <FeedSection
          key={section.name}
          section={section}
          surfacedSubtasks={section.name === "needs_review" ? surfacedSubtasks : undefined}
          parentTitleById={parentTitleById}
          config={config}
        />
      ))}
      {isEmpty && (
        <div className="p-6 text-[var(--text-2)]">
          <p className="font-forge-sans text-sm">No tasks yet</p>
        </div>
      )}
    </div>
  );
}
