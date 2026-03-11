//! Action buttons for a feed row, keyed to the task's current state.
//! Keyboard shortcuts are declared on the buttons themselves via Button —
//! the enclosing HotkeyScope (on the focused row) dispatches matching keypresses.

import { useWorkflowConfig } from "../../providers";
import { usePrStatus } from "../../providers/PrStatusProvider";
import type { WorkflowTaskView } from "../../types/workflow";
import { openExternal } from "../../utils/openExternal";
import { isActivelyProgressing } from "../../utils/taskStatus";
import { Button } from "../ui/Button";
import { LatestLogSummary } from "./LatestLogSummary";

interface FeedRowActionsProps {
  task: WorkflowTaskView;
  onReview: () => void;
  onAnswer: () => void;
  onApprove: () => void;
  onMerge: () => void;
  onOpenPr: () => void;
  onArchive: () => void;
}

export function FeedRowActions({
  task,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
  onArchive,
}: FeedRowActionsProps) {
  const config = useWorkflowConfig();
  const { getPrStatus } = usePrStatus();
  const { derived } = task;

  const approveVariant = (() => {
    const stage = config.stages.find((s) => s.name === derived.current_stage);
    return stage?.capabilities.subtasks ? ("outline-teal" as const) : ("outline-violet" as const);
  })();

  if (derived.is_failed) {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          hotkey="r"
          variant="outline-destructive"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (derived.has_questions) {
    return (
      <div className="flex items-center gap-1.5">
        <Button hotkey="a" variant="outline-submit" size="sm" onClick={onAnswer}>
          Answer
        </Button>
      </div>
    );
  }

  if (derived.needs_review) {
    return (
      <div className="flex items-center gap-1.5">
        <Button hotkey="r" variant={approveVariant} size="sm" onClick={onReview}>
          Review
        </Button>
        <Button
          hotkey="a"
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onApprove();
          }}
        >
          Approve
        </Button>
      </div>
    );
  }

  if (derived.is_done && !task.pr_url) {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          hotkey="m"
          variant="merge-outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onMerge();
          }}
        >
          Merge
        </Button>
        <Button
          hotkey="p"
          variant="merge-outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPr();
          }}
        >
          Open PR
        </Button>
      </div>
    );
  }

  if (derived.is_done && task.pr_url) {
    const prUrl = task.pr_url;
    const prStatus = getPrStatus(task.id);

    if (prStatus?.state === "merged") {
      return (
        <div className="flex items-center gap-1.5">
          <Button
            hotkey="x"
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            Archive
          </Button>
          <Button
            hotkey="v"
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openExternal(prUrl);
            }}
          >
            View ↗
          </Button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        <Button hotkey="p" variant="merge-outline" size="sm" onClick={onReview}>
          PR
        </Button>
        <Button
          hotkey="v"
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            openExternal(prUrl);
          }}
        >
          View ↗
        </Button>
      </div>
    );
  }

  if (task.state.type === "integrating" || isActivelyProgressing(task)) {
    return <LatestLogSummary task={task} />;
  }

  return null;
}
