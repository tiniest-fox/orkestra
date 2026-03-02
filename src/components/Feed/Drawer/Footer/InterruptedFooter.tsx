//! Footer for the interrupted state — optional guidance textarea with a resume button.

import type React from "react";
import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface InterruptedFooterProps {
  resumeMessage: string;
  onResumeMessageChange: (v: string) => void;
  resumeTextareaRef: React.RefObject<HTMLTextAreaElement>;
  resuming: boolean;
  onResume: () => void;
  onEnterChatMode: () => void;
}

export function InterruptedFooter({
  resumeMessage,
  onResumeMessageChange,
  resumeTextareaRef,
  resuming,
  onResume,
  onEnterChatMode,
}: InterruptedFooterProps) {
  return (
    <FooterBar className="flex-col h-auto py-3 px-4 gap-2">
      <textarea
        ref={resumeTextareaRef}
        value={resumeMessage}
        onChange={(e) => onResumeMessageChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onResume();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            resumeTextareaRef.current?.blur();
          }
        }}
        placeholder="Optional guidance for the agent…"
        rows={2}
        className="w-full font-sans text-[13px] text-text-primary placeholder:text-text-quaternary bg-[#F4F0F8] border border-border rounded px-3 py-2 resize-none focus:outline-none focus:border-text-tertiary transition-colors"
      />
      <div className="flex gap-2 w-full">
        <Button variant="primary" onClick={onResume} disabled={resuming}>
          {resuming ? (
            "Resuming…"
          ) : (
            <>
              Resume <span className="font-mono text-[10px] font-medium opacity-60 ml-3">⌘↵</span>
            </>
          )}
        </Button>
        <Button variant="secondary" onClick={onEnterChatMode} disabled={resuming}>
          Chat
        </Button>
      </div>
    </FooterBar>
  );
}
