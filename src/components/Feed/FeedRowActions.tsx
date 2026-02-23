//! Action buttons for a feed row, keyed to the task's current state.
//! Keyboard shortcuts are declared on the buttons themselves via HotkeyButton —
//! the enclosing HotkeyScope (on the focused row) dispatches matching keypresses.

import { useWorkflowConfig } from "../../providers";
import type { WorkflowTaskView } from "../../types/workflow";
import { openExternal } from "../../utils/openExternal";
import { HotkeyButton } from "../ui/HotkeyButton";

interface FeedRowActionsProps {
  task: WorkflowTaskView;
  onReview: () => void;
  onAnswer: () => void;
  onMerge: () => void;
  onOpenPr: () => void;
  onArchive: () => void;
}

const base =
  "inline-flex items-center font-forge-sans text-[12px] font-medium px-2.5 py-1 rounded-md border cursor-pointer bg-white transition-colors whitespace-nowrap leading-snug";

const variants = {
  reviewViolet: `${base} border-[var(--violet-border)] text-[var(--violet)] hover:bg-[var(--violet-bg)] hover:border-[var(--violet)]`,
  reviewTeal:   `${base} border-[var(--teal-border)]   text-[var(--teal)]   hover:bg-[var(--teal-bg)]   hover:border-[var(--teal)]`,
  secondary: `${base} border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--text-3)]`,
  answer: `${base} border-[var(--blue-border)] text-[var(--blue)] hover:bg-[var(--blue-bg)] hover:border-[var(--blue)]`,
  retry: `${base} border-[rgba(220,38,38,0.35)] text-[var(--red)] hover:bg-[var(--red-bg)] hover:border-[var(--red)]`,
  ship: `${base} border-[var(--peach-border)] text-[var(--peach)] hover:bg-[var(--peach-bg)] hover:border-[var(--peach)]`,
};

export function FeedRowActions({ task, onReview, onAnswer, onMerge, onOpenPr, onArchive }: FeedRowActionsProps) {
  const config = useWorkflowConfig();
  const { derived } = task;

  const reviewVariant = (() => {
    const stage = config.stages.find((s) => s.name === derived.current_stage);
    return stage?.capabilities.subtasks ? variants.reviewTeal : variants.reviewViolet;
  })();

  if (derived.is_failed) {
    return (
      <div className="flex items-center gap-1.5">
        <HotkeyButton hotkey="r" className={variants.retry}>Retry</HotkeyButton>
      </div>
    );
  }

  if (derived.has_questions) {
    return (
      <div className="flex items-center gap-1.5">
        <HotkeyButton hotkey="a" className={variants.answer} onClick={onAnswer}>Answer</HotkeyButton>
      </div>
    );
  }

  if (derived.needs_review) {
    return (
      <div className="flex items-center gap-1.5">
        <HotkeyButton hotkey="r" className={reviewVariant} onClick={onReview}>Review</HotkeyButton>
        <HotkeyButton hotkey="a" className={variants.secondary}>Approve</HotkeyButton>
      </div>
    );
  }

  if (derived.is_done && !task.pr_url) {
    return (
      <div className="flex items-center gap-1.5">
        <HotkeyButton hotkey="m" className={variants.ship} onClick={onMerge}>Merge</HotkeyButton>
        <HotkeyButton hotkey="p" className={variants.ship} onClick={onOpenPr}>Open PR</HotkeyButton>
        <HotkeyButton hotkey="x" className={variants.secondary} onClick={onArchive}>Archive</HotkeyButton>
      </div>
    );
  }

  if (derived.is_done && task.pr_url) {
    const prUrl = task.pr_url;
    return (
      <div className="flex items-center gap-1.5">
        <HotkeyButton hotkey="p" className={variants.ship} onClick={onReview}>PR</HotkeyButton>
        <HotkeyButton hotkey="v" className={variants.secondary} onClick={(e) => { e.stopPropagation(); openExternal(prUrl); }}>View ↗</HotkeyButton>
      </div>
    );
  }

  return null;
}
