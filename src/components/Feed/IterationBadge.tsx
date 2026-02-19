//! Iteration count suffix shown when a stage has multiple iterations.

import type { WorkflowTaskView } from "../../types/workflow";

interface IterationBadgeProps {
  task: WorkflowTaskView;
}

export function IterationBadge({ task }: IterationBadgeProps) {
  const { derived, iterations } = task;

  if (derived.is_done || derived.is_archived) return null;

  const currentStage = derived.current_stage;
  if (!currentStage) return null;

  const count = iterations.filter((i) => i.stage === currentStage).length;
  if (count < 2) return null;

  const display = count > 9 ? "·9+" : `·${count}`;
  const colorClass = count >= 4 ? "text-[var(--amber)]" : "text-[var(--text-2)]";

  return (
    <span className={`font-forge-mono text-[10px] ml-2 shrink-0 ${colorClass}`}>{display}</span>
  );
}
