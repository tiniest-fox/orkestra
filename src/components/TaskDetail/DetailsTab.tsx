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
    <div className="p-4">
      {task.description && (
        <p className="text-stone-600 text-sm whitespace-pre-wrap">{task.description}</p>
      )}

      {task.status.type === "failed" && (
        <div className="mt-3 space-y-3">
          {task.status.error && (
            <div className="p-3 bg-error-50 border border-error-200 rounded-panel-sm">
              <div className="text-xs font-medium text-error-700 mb-1">Error</div>
              <p className="text-sm text-error-800">{task.status.error}</p>
            </div>
          )}
          <Button
            variant="destructive"
            fullWidth
            onClick={onRetry}
            disabled={isRetrying}
            loading={isRetrying}
          >
            Retry Task
          </Button>
        </div>
      )}

      {task.status.type === "blocked" && task.status.reason && (
        <div className="mt-3 p-3 bg-warning-50 border border-warning-200 rounded-panel-sm">
          <div className="text-xs font-medium text-warning-700 mb-1">Blocked</div>
          <p className="text-sm text-warning-800">{task.status.reason}</p>
        </div>
      )}
    </div>
  );
}
