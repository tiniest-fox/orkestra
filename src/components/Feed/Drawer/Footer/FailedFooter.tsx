//! Footer for the failed state — optional instructions textarea with a retry button.

import type React from "react";
import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface FailedFooterProps {
  retryInstructions: string;
  onRetryInstructionsChange: (v: string) => void;
  retryTextareaRef: React.RefObject<HTMLTextAreaElement>;
  retrying: boolean;
  onRetry: () => void;
}

export function FailedFooter({
  retryInstructions,
  onRetryInstructionsChange,
  retryTextareaRef,
  retrying,
  onRetry,
}: FailedFooterProps) {
  return (
    <FooterBar className="flex-col h-auto py-3 px-4 gap-2">
      <textarea
        ref={retryTextareaRef}
        value={retryInstructions}
        onChange={(e) => onRetryInstructionsChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onRetry();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            retryTextareaRef.current?.blur();
          }
        }}
        placeholder="Optional guidance for the agent…"
        rows={2}
        className="w-full font-sans text-[13px] text-text-primary placeholder:text-text-quaternary bg-[#F4F0F8] border border-border rounded px-3 py-2 resize-none focus:outline-none focus:border-text-tertiary transition-colors"
      />
      <Button variant="primary" fullWidth onClick={onRetry} disabled={retrying}>
        {retrying ? (
          "Retrying…"
        ) : (
          <>
            Retry <span className="font-mono text-[10px] font-medium opacity-60 ml-3">⌘↵</span>
          </>
        )}
      </Button>
    </FooterBar>
  );
}
