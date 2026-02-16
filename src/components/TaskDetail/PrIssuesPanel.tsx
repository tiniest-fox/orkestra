/**
 * PR issues panel - action to address conflicts or comments.
 *
 * Shows "Fix Conflicts" or "Address Comments" button for Done tasks with PR issues.
 * When conflicts exist, they must be resolved first (transitions task to work stage).
 * Comments can be addressed after conflicts are resolved.
 */

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { PrComment, PrCommentData } from "../../types/workflow";
import { Button, Panel } from "../ui";

interface PrIssuesPanelProps {
  taskId: string;
  /** Base branch for conflict resolution (e.g., "main"). */
  baseBranch: string;
  /** Whether the PR has merge conflicts. */
  hasConflicts: boolean;
  /** All available comments (from PR status). */
  allComments: PrComment[];
  /** IDs of currently selected comments. */
  selectedCommentIds: Set<number>;
  guidance?: string;
  onSuccess: () => void;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
}

export function PrIssuesPanel({
  taskId,
  baseBranch,
  hasConflicts,
  allComments,
  selectedCommentIds,
  guidance,
  onSuccess,
  isSubmitting,
  setIsSubmitting,
}: PrIssuesPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const hasSelection = selectedCommentIds.size > 0;
  const canSubmit = hasConflicts || hasSelection;

  const handleFix = async () => {
    if (!canSubmit) return;

    setError(null);
    setIsSubmitting(true);
    try {
      // Address conflicts first (if any)
      if (hasConflicts) {
        await invoke("workflow_address_pr_conflicts", {
          taskId,
          baseBranch: `origin/${baseBranch}`,
        });
      }
      // If only comments (no conflicts), use existing comments API
      else if (hasSelection) {
        const comments: PrCommentData[] = allComments
          .filter((c) => selectedCommentIds.has(c.id))
          .map((c) => ({
            author: c.author,
            body: c.body,
            path: c.path ?? null,
            line: c.line ?? null,
          }));
        await invoke("workflow_address_pr_comments", {
          taskId,
          comments,
          guidance: guidance || null,
        });
      }
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to fix PR issues:", err);
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // When conflicts exist, always show "Fix Conflicts" — comments can be addressed after
  const buttonLabel = hasConflicts ? "Fix Conflicts" : "Address Comments";

  const descriptionText = hasConflicts
    ? hasSelection
      ? `Merge conflicts detected. ${selectedCommentIds.size} comment${selectedCommentIds.size > 1 ? "s" : ""} selected. Resolve conflicts first, then address comments.`
      : "Merge conflicts detected. Click below to resolve them and return to the work stage."
    : hasSelection
      ? `${selectedCommentIds.size} comment${selectedCommentIds.size > 1 ? "s" : ""} selected. Click below to return to the work stage.`
      : "Select comments in the PR tab to address them.";

  const accentColor = hasConflicts ? "warning" : "info";
  const titleText = hasConflicts ? "PR Issues" : "Address PR Comments";
  const titleColorClass = hasConflicts
    ? "text-warning-600 dark:text-warning-400"
    : "text-info-600 dark:text-info-400";

  return (
    <Panel accent={accentColor} autoFill={false} padded={true} className="h-[200px] flex flex-col">
      <div className={`text-sm font-medium ${titleColorClass} mb-3`}>{titleText}</div>
      <p className="text-sm text-stone-600 dark:text-stone-400 mb-3 flex-1">{descriptionText}</p>
      {error && <p className="text-sm text-error-600 dark:text-error-400 mb-3">{error}</p>}
      <Button
        onClick={handleFix}
        disabled={!canSubmit || isSubmitting}
        loading={isSubmitting}
        fullWidth
        variant={hasConflicts ? "warning" : "info"}
      >
        {buttonLabel}
      </Button>
    </Panel>
  );
}
