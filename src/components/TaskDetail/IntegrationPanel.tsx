/**
 * Integration panel - merge or PR options for Done tasks.
 *
 * Shows Auto-merge and Open PR buttons for Done+Idle tasks.
 * When feedback is entered, shows Request Update button instead.
 * For Failed tasks (PR creation failure), shows error and Retry button.
 */

import { useState } from "react";
import type { TaskState } from "../../types/workflow";
import { Button, Panel } from "../ui";

interface IntegrationPanelProps {
  state: TaskState;
  onMerge: () => void;
  onOpenPr: () => void;
  onRetryPr: () => void;
  onRequestUpdate: (feedback: string) => void;
  isSubmitting: boolean;
  /** Whether the `gh` CLI is available. When false, the Open PR button is disabled. */
  ghAvailable: boolean;
}

export function IntegrationPanel({
  state,
  onMerge,
  onOpenPr,
  onRetryPr,
  onRequestUpdate,
  isSubmitting,
  ghAvailable,
}: IntegrationPanelProps) {
  const [feedback, setFeedback] = useState("");

  const handleRequestUpdate = () => {
    onRequestUpdate(feedback.trim());
    setFeedback("");
  };

  // Failed state — show error and retry
  if (state.type === "failed") {
    return (
      <Panel accent="error" autoFill={false} padded={true} className="h-[200px] flex flex-col">
        <div className="text-sm font-medium text-error-600 dark:text-error-400 mb-3">
          PR Creation Failed
        </div>
        {state.error && (
          <div className="flex-1 text-sm text-error-700 dark:text-error-300 overflow-y-auto mb-3">
            {state.error}
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
      <div className="text-sm font-medium text-info-600 dark:text-info-400 mb-3">Integration</div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Leave feedback to request changes..."
        className="w-full flex-1 px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-600 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-info-500 resize-none mb-3"
      />
      {feedback.trim() ? (
        <Button
          onClick={handleRequestUpdate}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          variant="warning"
        >
          Request Update
        </Button>
      ) : (
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
            disabled={isSubmitting || !ghAvailable}
            loading={isSubmitting}
            fullWidth
            className="bg-info-500 hover:bg-info-600 text-white"
            title={ghAvailable ? undefined : "Requires gh CLI to create PRs"}
          >
            Open PR
          </Button>
        </div>
      )}
    </Panel>
  );
}
