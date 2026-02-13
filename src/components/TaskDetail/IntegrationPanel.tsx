/**
 * Integration panel - merge or PR options for Done tasks.
 *
 * Shows Auto-merge and Open PR buttons for Done+Idle tasks.
 * For Failed tasks (PR creation failure), shows error and Retry button.
 */

import type { WorkflowTaskStatus } from "../../types/workflow";
import { Button, Panel } from "../ui";

interface IntegrationPanelProps {
  status: WorkflowTaskStatus;
  onMerge: () => void;
  onOpenPr: () => void;
  onRetryPr: () => void;
  isSubmitting: boolean;
}

export function IntegrationPanel({
  status,
  onMerge,
  onOpenPr,
  onRetryPr,
  isSubmitting,
}: IntegrationPanelProps) {
  // Failed state — show error and retry
  if (status.type === "failed") {
    return (
      <Panel accent="error" autoFill={false} padded={true} className="h-[200px] flex flex-col">
        <div className="text-sm font-medium text-error-600 dark:text-error-400 mb-3">
          PR Creation Failed
        </div>
        {status.error && (
          <div className="flex-1 text-sm text-error-700 dark:text-error-300 overflow-y-auto mb-3">
            {status.error}
          </div>
        )}
        <Button
          onClick={onRetryPr}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-error-500 hover:bg-error-600 text-white"
        >
          Retry
        </Button>
      </Panel>
    );
  }

  // Done+Idle state — show integration options
  return (
    <Panel accent="info" autoFill={false} padded={true} className="h-[200px] flex flex-col">
      <div className="text-sm font-medium text-info-600 dark:text-info-400 mb-3">
        Integration
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-400 mb-3 flex-1">
        Task complete. Choose how to integrate the changes:
      </p>
      <div className="flex gap-2">
        <Button
          onClick={onMerge}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-success-500 hover:bg-success-600 text-white"
        >
          Auto-merge
        </Button>
        <Button
          onClick={onOpenPr}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-info-500 hover:bg-info-600 text-white"
        >
          Open PR
        </Button>
      </div>
    </Panel>
  );
}
