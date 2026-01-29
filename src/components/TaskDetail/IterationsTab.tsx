/**
 * Iterations tab - displays activity history.
 */

import type { WorkflowIteration } from "../../types/workflow";
import { IterationCard } from "./IterationCard";

interface IterationsTabProps {
  iterations: WorkflowIteration[];
}

export function IterationsTab({ iterations }: IterationsTabProps) {
  return (
    <>
      <div className="text-sm font-medium text-stone-700 mb-4">Activity</div>
      {iterations.length === 0 ? (
        <div className="text-stone-500 text-sm">No iterations recorded yet.</div>
      ) : (
        <div className="space-y-4">
          {[...iterations]
            .sort((a, b) => a.started_at.localeCompare(b.started_at))
            .map((iteration) => (
              <IterationCard key={iteration.id} iteration={iteration} />
            ))}
        </div>
      )}
    </>
  );
}
