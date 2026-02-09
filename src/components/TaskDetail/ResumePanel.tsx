/**
 * Resume panel - interface for resuming an interrupted task.
 */

import { useState } from "react";
import { Button, Panel } from "../ui";

interface ResumePanelProps {
  onResume: (message?: string) => void;
  isSubmitting: boolean;
}

export function ResumePanel({ onResume, isSubmitting }: ResumePanelProps) {
  const [message, setMessage] = useState("");

  const handleResume = () => {
    onResume(message.trim() || undefined);
    setMessage("");
  };

  return (
    <Panel accent="info" autoFill={false} padded={true} className="h-[200px] flex flex-col">
      <div className="text-sm font-medium text-info-600 dark:text-info-400 mb-3">
        Task Interrupted
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Add a message for the agent (optional)..."
        className="w-full flex-1 px-3 py-2 text-sm border border-stone-300 dark:bg-stone-800 dark:border-stone-600 dark:text-stone-100 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-info-500 resize-none mb-3 text-stone-800"
      />
      <Button
        onClick={handleResume}
        disabled={isSubmitting}
        loading={isSubmitting}
        fullWidth
        className="bg-info-500 hover:bg-info-600 text-white"
      >
        Resume
      </Button>
    </Panel>
  );
}
