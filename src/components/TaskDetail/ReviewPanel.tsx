/**
 * Review panel - approve/reject interface with feedback.
 *
 * When a pending rejection is present, shows the agent's rejection feedback
 * and offers confirm/override actions instead of the standard approve/reject.
 */

import { useState } from "react";
import type { PendingRejection } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { Button, Panel } from "../ui";

interface ReviewPanelProps {
  stageName: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  isSubmitting: boolean;
  pendingRejection?: PendingRejection | null;
}

export function ReviewPanel({
  stageName,
  onApprove,
  onReject,
  isSubmitting,
  pendingRejection,
}: ReviewPanelProps) {
  const [feedback, setFeedback] = useState("");

  const handleReject = () => {
    if (feedback.trim()) {
      onReject(feedback.trim());
      setFeedback("");
    }
  };

  if (pendingRejection) {
    return (
      <Panel accent="error" autoFill={false} padded={true} className="h-[320px] flex flex-col">
        <div className="text-sm font-medium text-error-600 dark:text-error-400 mb-2">
          {titleCase(stageName)} — Rejection Verdict
        </div>
        <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">
          Agent wants to send back to{" "}
          <span className="font-medium">{titleCase(pendingRejection.target)}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto text-sm text-stone-700 dark:text-stone-300 bg-stone-100 dark:bg-stone-800 rounded-panel-sm px-3 py-2 mb-3 border border-stone-200 dark:border-stone-700">
          {pendingRejection.feedback}
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Override feedback (leave empty to confirm rejection)..."
          className="w-full h-16 shrink-0 px-3 py-2 text-sm border border-stone-300 dark:bg-stone-800 dark:border-stone-600 dark:text-stone-100 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-warning-500 resize-none mb-3 text-stone-800"
        />
        {feedback.trim() ? (
          <Button
            onClick={handleReject}
            disabled={isSubmitting}
            loading={isSubmitting}
            fullWidth
            className="bg-warning-500 hover:bg-warning-600 text-white"
          >
            Override — Request New Verdict
          </Button>
        ) : (
          <Button
            onClick={onApprove}
            disabled={isSubmitting}
            loading={isSubmitting}
            fullWidth
            className="bg-error-500 hover:bg-error-600 text-white"
          >
            Confirm Rejection
          </Button>
        )}
      </Panel>
    );
  }

  return (
    <Panel accent="warning" autoFill={false} padded={true} className="h-[320px] flex flex-col">
      <div className="text-sm font-medium text-warning-600 dark:text-warning-400 mb-3">
        {titleCase(stageName)} Review
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Leave feedback to request changes..."
        className="w-full flex-1 px-3 py-2 text-sm border border-stone-300 dark:bg-stone-800 dark:border-stone-600 dark:text-stone-100 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-warning-500 resize-none mb-3 text-stone-800"
      />
      {feedback.trim() ? (
        <Button
          onClick={handleReject}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-warning-500 hover:bg-warning-600 text-white"
        >
          Request Changes
        </Button>
      ) : (
        <Button
          onClick={onApprove}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-success-500 hover:bg-success-600 text-white"
        >
          Approve
        </Button>
      )}
    </Panel>
  );
}
