/**
 * Details tab - displays task description and status-specific content.
 */

import { useState } from "react";
import type { WorkflowTask } from "../../types/workflow";
import { Button } from "../ui";

interface DetailsTabProps {
  task: WorkflowTask;
  onRetry?: (instructions?: string) => void;
  isRetrying?: boolean;
}

export function DetailsTab({ task, onRetry, isRetrying }: DetailsTabProps) {
  const [instructions, setInstructions] = useState("");

  const handleRetry = () => {
    if (onRetry) {
      onRetry(instructions.trim() || undefined);
      setInstructions("");
    }
  };

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
          {onRetry && (
            <>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Instructions for the agent on how to resolve this..."
                className="w-full h-20 px-3 py-2 text-sm border border-stone-300 dark:bg-stone-800 dark:border-stone-600 dark:text-stone-100 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-stone-800"
              />
              <Button
                variant="destructive"
                fullWidth
                onClick={handleRetry}
                disabled={isRetrying}
                loading={isRetrying}
              >
                Retry Task
              </Button>
            </>
          )}
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
          {onRetry && (
            <>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Instructions for the agent on how to resolve this..."
                className="w-full h-20 px-3 py-2 text-sm border border-stone-300 dark:bg-stone-800 dark:border-stone-600 dark:text-stone-100 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-stone-800"
              />
              <Button
                variant="destructive"
                fullWidth
                onClick={handleRetry}
                disabled={isRetrying}
                loading={isRetrying}
              >
                Retry Task
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
