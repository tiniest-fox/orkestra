/**
 * Delete confirmation panel - destructive action confirmation in the footer panel slot.
 */

import { Button, Panel } from "../ui";

interface DeleteConfirmPanelProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmPanel({ onConfirm, onCancel }: DeleteConfirmPanelProps) {
  return (
    <Panel accent="error" autoFill={false} padded={true} className="h-[200px]">
      <div className="text-sm font-medium text-error-600 mb-3">
        Delete task? This cannot be undone.
      </div>
      <div className="flex gap-2">
        <Button
          onClick={onConfirm}
          fullWidth
          className="bg-error-500 hover:bg-error-600 text-white"
        >
          Delete
        </Button>
        <Button onClick={onCancel} variant="secondary" fullWidth>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}
