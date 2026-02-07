/**
 * Iterations tab - displays activity history.
 */

import { Repeat } from "lucide-react";
import type { WorkflowIteration } from "../../types/workflow";
import { EmptyState } from "../ui";
import { IterationCard } from "./IterationCard";

interface IterationsTabProps {
  iterations: WorkflowIteration[];
}

export function IterationsTab({ iterations }: IterationsTabProps) {
  return (
    <div className="p-4">
      <div className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-4">Activity</div>
      {iterations.length === 0 ? (
        <EmptyState icon={Repeat} message="No iterations recorded yet." />
      ) : (
        <div className="space-y-4">
          {[...iterations]
            .sort((a, b) => a.started_at.localeCompare(b.started_at))
            .map((iteration) => (
              <IterationCard key={iteration.id} iteration={iteration} />
            ))}
        </div>
      )}
    </div>
  );
}
