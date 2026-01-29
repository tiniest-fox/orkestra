/**
 * Details tab - displays task description and status-specific content.
 */

import type { WorkflowTask } from "../../types/workflow";
import { Button } from "../ui";

interface DetailsTabProps {
  task: WorkflowTask;
  onRetry: () => void;
  isRetrying: boolean;
}

export function DetailsTab({ task, onRetry, isRetrying }: DetailsTabProps) {
  return (
    <>
      {task.description && <p className="text-stone-600 text-sm whitespace-pre-wrap">{task.description}</p>}

      {task.status.type === "failed" && (
        <div className="mt-3 space-y-3">
          {task.status.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-panel-sm">
              <div className="text-xs font-medium text-error mb-1">Error</div>
              <p className="text-sm text-red-800">{task.status.error}</p>
            </div>
          )}
          <Button variant="destructive" fullWidth onClick={onRetry} disabled={isRetrying} loading={isRetrying}>
            Retry Task
          </Button>
        </div>
      )}

      {task.status.type === "blocked" && task.status.reason && (
        <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-panel-sm">
          <div className="text-xs font-medium text-blocked mb-1">Blocked</div>
          <p className="text-sm text-orange-800">{task.status.reason}</p>
        </div>
      )}
    </>
  );
}
