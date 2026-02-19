//! Shared 4-column grid row used by FeedTaskRow and FeedSubtaskRow.

import { useMemo } from "react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { computePipelineSegments } from "../../utils/pipelineSegments";
import { IterationBadge } from "./IterationBadge";
import { PipelineBar } from "./PipelineBar";
import { StatusSymbol } from "./StatusSymbol";

interface FeedRowProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
  paddingClass: string;
  subtitle: React.ReactNode;
  faded?: boolean;
}

export function FeedRow({ task, config, paddingClass, subtitle, faded }: FeedRowProps) {
  const segments = useMemo(() => computePipelineSegments(task, config), [task, config]);

  return (
    <div
      className={`grid grid-cols-[18px_minmax(0,220px)_148px_auto] gap-4 ${paddingClass} py-2 min-h-[40px] items-center hover:bg-[var(--surface-hover)]${faded ? " opacity-[0.38]" : ""}`}
    >
      <StatusSymbol task={task} />
      <div className="min-w-0">
        <div className="font-forge-sans text-[13px] font-medium tracking-[-0.01em] truncate text-[var(--text-0)]">
          {task.title}
        </div>
        <div className="font-forge-mono text-[10px] text-[var(--text-2)]">{subtitle}</div>
      </div>
      <div className="flex items-center">
        <PipelineBar segments={segments} />
        <IterationBadge task={task} />
      </div>
      <div />
    </div>
  );
}
