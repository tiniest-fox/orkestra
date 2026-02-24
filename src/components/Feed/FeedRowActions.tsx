//! Action buttons for a feed row, keyed to the task's current state.
//! Keyboard shortcuts are declared on the buttons themselves via Button —
//! the enclosing HotkeyScope (on the focused row) dispatches matching keypresses.

import { useWorkflowConfig } from "../../providers";
import type { WorkflowTaskView } from "../../types/workflow";
import { openExternal } from "../../utils/openExternal";
import { Button } from "../ui/Button";

interface FeedRowActionsProps {
  task: WorkflowTaskView;
  onReview: () => void;
  onAnswer: () => void;
  onMerge: () => void;
  onOpenPr: () => void;
  onArchive: () => void;
}

export function FeedRowActions({
  task,
  onReview,
  onAnswer,
  onMerge,
  onOpenPr,
  onArchive,
}: FeedRowActionsProps) {
  const config = useWorkflowConfig();
  const { derived } = task;

  const approveClass = (() => {
    const stage = config.stages.find((s) => s.name === derived.current_stage);
    return stage?.capabilities.subtasks
      ? "bg-[#0D9488] hover:bg-[#0B7D74] text-white border-transparent"
      : "bg-[#7C3AED] hover:bg-[#6D28D9] text-white border-transparent";
  })();

  if (derived.is_failed) {
    return (
      <div className="flex items-center gap-1.5">
        <Button hotkey="r" variant="destructive" size="sm">
          Retry
        </Button>
      </div>
    );
  }

  if (derived.has_questions) {
    return (
      <div className="flex items-center gap-1.5">
        <Button hotkey="a" variant="submit" size="sm" onClick={onAnswer}>
          Answer
        </Button>
      </div>
    );
  }

  if (derived.needs_review) {
    return (
      <div className="flex items-center gap-1.5">
        <Button hotkey="r" variant="custom" size="sm" className={approveClass} onClick={onReview}>
          Review
        </Button>
        <Button hotkey="a" variant="secondary" size="sm">
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
          variant="custom"
          size="sm"
          className="bg-[#C85A4C] hover:bg-[#B85040] text-white border-transparent"
          onClick={onMerge}
        >
          Merge
        </Button>
        <Button
          hotkey="p"
          variant="custom"
          size="sm"
          className="bg-transparent border-[#C85A4C]/30 text-[#C85A4C] hover:bg-[#C85A4C]/7"
          onClick={onOpenPr}
        >
          Open PR
        </Button>
        <Button hotkey="x" variant="secondary" size="sm" onClick={onArchive}>
          Archive
        </Button>
      </div>
    );
  }

  if (derived.is_done && task.pr_url) {
    const prUrl = task.pr_url;
    return (
      <div className="flex items-center gap-1.5">
        <Button
          hotkey="p"
          variant="custom"
          size="sm"
          className="bg-[#C85A4C] hover:bg-[#B85040] text-white border-transparent"
          onClick={onReview}
        >
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

  return null;
}
