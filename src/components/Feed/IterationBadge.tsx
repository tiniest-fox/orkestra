//! Iteration count suffix shown when a stage has multiple iterations.

import type { WorkflowTaskView } from "../../types/workflow";

interface IterationBadgeProps {
  task: WorkflowTaskView;
}

export function IterationBadge({ task }: IterationBadgeProps) {
  const { derived, iterations } = task;

  const currentStage = derived.current_stage;
  const count = currentStage ? iterations.filter((i) => i.stage === currentStage).length : 0;
  const show = !derived.is_done && !derived.is_archived && count >= 2;

  if (!show) return <span />;

  const display = count > 9 ? "·9+" : `·${count}`;
  const colorClass = count >= 4 ? "text-[var(--amber)]" : "text-[var(--text-2)]";

  return (
    <span className={`font-forge-mono text-[10px] font-medium shrink-0 ${colorClass}`}>{display}</span>
  );
}
