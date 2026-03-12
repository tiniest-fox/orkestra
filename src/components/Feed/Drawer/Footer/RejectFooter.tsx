//! Footer for reject mode — feedback textarea above send/cancel actions.

import type React from "react";
import { useIsMobile } from "../../../../hooks/useIsMobile";
import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface RejectFooterProps {
  reviewVariant: "violet" | "teal";
  feedback: string;
  onFeedbackChange: (v: string) => void;
  feedbackRef: React.RefObject<HTMLTextAreaElement>;
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
  const isMobile = useIsMobile();

  return (
    <FooterBar className="flex-col h-auto pt-3 pb-3 gap-2">
      <textarea
        ref={feedbackRef}
        value={feedback}
        onChange={(e) => onFeedbackChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (feedback.trim()) onReject();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onExitRejectMode();
          }
        }}
        placeholder="What needs to change?"
        rows={3}
        className="w-full font-sans text-[13px] text-text-primary placeholder:text-text-quaternary bg-surface-2 border border-border rounded px-3 py-2 resize-none focus:outline-none focus:border-text-tertiary transition-colors"
      />
      <div className="flex gap-2 w-full">
        <Button
          variant={reviewVariant === "violet" ? "violet" : "teal"}
          className="flex-1 justify-center"
          onClick={onReject}
          disabled={loading || !feedback.trim()}
        >
          {loading ? (
            "Sending…"
          ) : (
            <>
              Send feedback
              {!isMobile && (
                <span className="font-mono text-[10px] font-medium opacity-60 ml-3">⌘↵</span>
              )}
            </>
          )}
        </Button>
        <Button
          variant="secondary"
          className="flex-1 justify-center"
          onClick={onExitRejectMode}
          disabled={loading}
        >
          Cancel
        </Button>
      </div>
    </FooterBar>
  );
}
