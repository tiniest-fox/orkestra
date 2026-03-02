//! Footer for reject mode — inline feedback input with send/cancel actions.

import type React from "react";
import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface RejectFooterProps {
  reviewVariant: "violet" | "teal";
  feedback: string;
  onFeedbackChange: (v: string) => void;
  feedbackRef: React.RefObject<HTMLInputElement>;
  loading: boolean;
  onReject: () => void;
  onExitRejectMode: () => void;
}

export function RejectFooter({
  reviewVariant,
  feedback,
  onFeedbackChange,
  feedbackRef,
  loading,
  onReject,
  onExitRejectMode,
}: RejectFooterProps) {
  return (
    <FooterBar>
      <input
        ref={feedbackRef}
        value={feedback}
        onChange={(e) => onFeedbackChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onReject();
          if (e.key === "Escape") {
            e.stopPropagation();
            onExitRejectMode();
          }
        }}
        placeholder="What needs to change?"
        className="flex-1 font-sans text-[12px] text-text-primary placeholder:text-text-quaternary bg-surface-2 border border-border rounded-md px-3 py-1.5 outline-none focus:border-text-quaternary transition-colors"
      />
      <Button
        variant={reviewVariant === "violet" ? "violet" : "teal"}
        onClick={onReject}
        disabled={loading || !feedback.trim()}
      >
        Send feedback
      </Button>
      <Button variant="secondary" onClick={onExitRejectMode} disabled={loading}>
        Cancel
      </Button>
    </FooterBar>
  );
}
