/**
 * PR comments panel - action to address selected comments.
 *
 * Shows "Address Comments" button for Done tasks with PR comments.
 * Button is disabled until at least one comment is selected.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PrComment, PrCommentData } from "../../types/workflow";
import { Button, Panel } from "../ui";

interface PrCommentsPanelProps {
  taskId: string;
  /** All available comments (from PR status). */
  allComments: PrComment[];
  /** IDs of currently selected comments. */
  selectedCommentIds: Set<number>;
  guidance?: string;
  onSuccess: () => void;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
}

export function PrCommentsPanel({
  taskId,
  allComments,
  selectedCommentIds,
  guidance,
  onSuccess,
  isSubmitting,
  setIsSubmitting,
}: PrCommentsPanelProps) {
  const hasSelection = selectedCommentIds.size > 0;

  const handleAddressComments = async () => {
    if (!hasSelection) return;

    // Filter selected comments and convert to backend format
    const comments: PrCommentData[] = allComments
      .filter((c) => selectedCommentIds.has(c.id))
      .map((c) => ({
        author: c.author,
        body: c.body,
        path: c.path ?? null,
        line: c.line ?? null,
      }));

    setIsSubmitting(true);
    try {
      await invoke("workflow_address_pr_comments", {
        taskId,
        comments,
        guidance: guidance || null,
      });
      onSuccess();
    } catch (err) {
      console.error("Failed to address PR comments:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Panel accent="info" autoFill={false} padded={true} className="h-[200px] flex flex-col">
      <div className="text-sm font-medium text-info-600 dark:text-info-400 mb-3">
        Address PR Comments
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-400 mb-3 flex-1">
        {hasSelection
          ? `${selectedCommentIds.size} comment${selectedCommentIds.size > 1 ? "s" : ""} selected. Click below to return to the work stage.`
          : "Select comments in the PR tab to address them."}
      </p>
      <Button
        onClick={handleAddressComments}
        disabled={!hasSelection || isSubmitting}
        loading={isSubmitting}
        fullWidth
        className="bg-info-500 hover:bg-info-600 text-white"
      >
        Address Comments
      </Button>
    </Panel>
  );
}
