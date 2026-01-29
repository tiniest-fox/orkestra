/**
 * Review panel - approve/reject interface with feedback.
 */

import { useState } from "react";
import { titleCase } from "../../utils/formatters";
import { Button, Panel } from "../ui";

interface ReviewPanelProps {
  stageName: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  isSubmitting: boolean;
}

export function ReviewPanel({ stageName, onApprove, onReject, isSubmitting }: ReviewPanelProps) {
  const [feedback, setFeedback] = useState("");

  const handleReject = () => {
    if (feedback.trim()) {
      onReject(feedback.trim());
      setFeedback("");
    }
  };

  return (
    <Panel accent="warning" autoFill={false} padded={true}>
      <div className="text-sm font-medium text-warning mb-3">{titleCase(stageName)} Review</div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Leave feedback to request changes..."
        className="w-full px-3 py-2 text-sm border border-stone-300 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-warning resize-none mb-3 text-stone-800"
        rows={2}
      />
      {feedback.trim() ? (
        <Button
          onClick={handleReject}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-warning hover:bg-amber-600 text-white"
        >
          Request Changes
        </Button>
      ) : (
        <Button
          onClick={onApprove}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-success hover:bg-emerald-600 text-white"
        >
          Approve
        </Button>
      )}
    </Panel>
  );
}
