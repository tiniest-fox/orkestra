//! Action buttons for a feed row, keyed to the task's current state.
//! Keyboard shortcuts are declared on the buttons themselves via Button —
//! the enclosing HotkeyScope (on the focused row) dispatches matching keypresses.

import { useWorkflowConfig } from "../../providers";
import type { PrStatus, WorkflowTaskView } from "../../types/workflow";
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
  fullWidth?: boolean;
  prStatus?: PrStatus;
}

export function FeedRowActions({
  task,
  onReview,
  onAnswer,
  onApprove,
  onMerge,
  onOpenPr,
  onArchive,
  fullWidth = false,
  prStatus,
}: FeedRowActionsProps) {
  const config = useWorkflowConfig();
  const { derived } = task;
  const containerCls = fullWidth ? "flex gap-1.5 w-full" : "flex items-center gap-1.5";
  const btnCls = fullWidth ? "flex-1 justify-center" : undefined;

  if (task.is_chat) return null;

  const approveVariant = (() => {
    const stage = config.flows[task.flow]?.stages.find((s) => s.name === derived.current_stage);
    return stage?.capabilities.subtasks ? ("outline-teal" as const) : ("outline-violet" as const);
  })();

  if (derived.has_questions) {
    return (
      <div className={containerCls}>
        <Button hotkey="a" variant="outline-submit" size="sm" onClick={onAnswer} className={btnCls}>
          Answer
        </Button>
      </div>
    );
  }

  if (derived.needs_review) {
    return (
      <div className={containerCls}>
        <Button hotkey="r" variant={approveVariant} size="sm" onClick={onReview} className={btnCls}>
          Review
        </Button>
        <Button
          hotkey="a"
          variant="secondary"
          size="sm"
          className={btnCls}
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
      <div className={containerCls}>
        <Button
          hotkey="m"
          variant="merge-outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onMerge();
          }}
          className={btnCls}
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
          className={btnCls}
        >
          Open PR
        </Button>
      </div>
    );
  }

  if (derived.is_done && task.pr_url) {
    const prUrl = task.pr_url;

    if (prStatus?.state === "merged") {
      return (
        <div className={containerCls}>
          <Button
            hotkey="x"
            variant="secondary"
            size="sm"
            className={btnCls}
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
            className={btnCls}
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
      <div className={containerCls}>
        <Button
          hotkey="p"
          variant="merge-outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onReview();
          }}
          className={btnCls}
        >
          PR
        </Button>
        <Button
          hotkey="v"
          variant="secondary"
          size="sm"
          className={btnCls}
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
