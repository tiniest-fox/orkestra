/**
 * NewTaskPanel - Side panel for creating new tasks.
 * Replaces the modal-based CreateTaskModal with a panel in the sidebar slot.
 */

import { useState } from "react";
import { BranchSelector } from "./BranchSelector";
import { Button, Panel } from "./ui";

interface NewTaskPanelProps {
  onClose: () => void;
  onSubmit: (description: string, autoMode: boolean, baseBranch: string | null) => Promise<void>;
}

export function NewTaskPanel({ onClose, onSubmit }: NewTaskPanelProps) {
  const [description, setDescription] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await onSubmit(description.trim(), autoMode, baseBranch);
      // Don't reset form - parent will close the panel
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
      setSubmitting(false);
    }
  };

  return (
    <Panel className="w-[480px]">
      <Panel.Header>
        <Panel.Title>New Task</Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        <Panel.Body className="flex-1" scrollable>
          {error && (
            <div className="p-3 mb-4 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel-sm text-error-700 dark:text-error-300 text-sm">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-2"
            >
              What do you want to do?
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-stone-300 dark:bg-stone-800 dark:border-stone-600 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none text-stone-800 dark:text-stone-100"
              placeholder="Describe the task..."
              // biome-ignore lint/a11y/noAutofocus: intentional focus for panel UX
              autoFocus
            />
            <BranchSelector value={baseBranch} onChange={setBaseBranch} />
          </div>

          <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={autoMode}
              onClick={() => setAutoMode(!autoMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                autoMode ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  autoMode ? "translate-x-[18px]" : "translate-x-[3px]"
                }`}
              />
            </button>
            <span className="text-sm text-stone-700 dark:text-stone-200">Auto mode</span>
          </label>
        </Panel.Body>

        <Panel.Footer className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !description.trim()} loading={submitting}>
            Create Task
          </Button>
        </Panel.Footer>
      </form>
    </Panel>
  );
}
