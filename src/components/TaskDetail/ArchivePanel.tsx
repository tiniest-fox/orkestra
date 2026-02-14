/**
 * Archive panel - shown for Done tasks with merged PRs.
 *
 * Provides a button to archive the task after its PR has been merged.
 */

import { Button, Panel } from "../ui";

interface ArchivePanelProps {
  onArchive: () => void;
  isSubmitting: boolean;
}

export function ArchivePanel({ onArchive, isSubmitting }: ArchivePanelProps) {
  return (
    <Panel accent="success" autoFill={false} padded={true} className="h-[200px] flex flex-col">
      <div className="text-sm font-medium text-success-600 dark:text-success-400 mb-3">
        PR Merged
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-400 mb-3 flex-1">
        This PR has been merged. Archive the task to mark it complete.
      </p>
      <Button
        onClick={onArchive}
        disabled={isSubmitting}
        loading={isSubmitting}
        fullWidth
        className="bg-success-500 hover:bg-success-600 text-white"
      >
        Archive
      </Button>
    </Panel>
  );
}
