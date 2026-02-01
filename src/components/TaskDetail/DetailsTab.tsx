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
        <p className="text-stone-600 dark:text-stone-300 text-sm whitespace-pre-wrap">
          {task.description}
        </p>
      )}

      {task.status.type === "failed" && (
        <div className="mt-3 space-y-3">
          {task.status.error && (
            <div className="p-3 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel-sm">
              <div className="text-xs font-medium text-error-700 dark:text-error-300 mb-1">
                Error
              </div>
              <p className="text-sm text-error-800 dark:text-error-200">{task.status.error}</p>
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

      {task.status.type === "blocked" && (
        <div className="mt-3 space-y-3">
          {task.status.reason && (
            <div className="p-3 bg-warning-50 dark:bg-warning-950 border border-warning-200 dark:border-warning-800 rounded-panel-sm">
              <div className="text-xs font-medium text-warning-700 dark:text-warning-300 mb-1">
                Blocked
              </div>
              <p className="text-sm text-warning-800 dark:text-warning-200">{task.status.reason}</p>
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
    </div>
  );
}
