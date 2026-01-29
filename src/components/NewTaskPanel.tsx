/**
 * NewTaskPanel - Side panel for creating new tasks.
 * Replaces the modal-based CreateTaskModal with a panel in the sidebar slot.
 */

import { useState } from "react";
import { Button, Panel } from "./ui";

interface NewTaskPanelProps {
  onClose: () => void;
  onSubmit: (description: string) => Promise<void>;
}

export function NewTaskPanel({ onClose, onSubmit }: NewTaskPanelProps) {
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await onSubmit(description.trim());
      // Don't reset form - App.tsx will transition to task detail view
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
      setSubmitting(false);
    }
  };

  return (
    <Panel>
      <Panel.Header>
        <Panel.Title>New Task</Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        <Panel.Body className="flex-1" scrollable>
          {error && (
            <div className="p-3 mb-4 bg-error-50 border border-error-200 rounded-panel-sm text-error-700 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-stone-700 mb-2">
              What do you want to do?
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-stone-300 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none text-stone-800"
              placeholder="Describe the task..."
              // biome-ignore lint/a11y/noAutofocus: intentional focus for panel UX
              autoFocus
            />
          </div>
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
