//! Footer for chat mode — send messages and return to work.

import type React from "react";
import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface ChatFooterProps {
  chatMessage: string;
  onChatMessageChange: (v: string) => void;
  chatTextareaRef: React.RefObject<HTMLTextAreaElement>;
  chatSending: boolean;
  chatAgentActive: boolean;
  onSendChat: () => void;
  onReturnToWork: () => void;
  onApprove: () => void;
  loading: boolean;
  canApprove: boolean;
  chatError: string | null;
}

export function ChatFooter({
  chatMessage,
  onChatMessageChange,
  chatTextareaRef,
  chatSending,
  chatAgentActive,
  onSendChat,
  onReturnToWork,
  onApprove,
  loading,
  canApprove,
  chatError,
}: ChatFooterProps) {
  const sendDisabled = chatSending || !chatMessage.trim() || chatAgentActive;

  return (
    <FooterBar className="flex-col h-auto py-3 px-4 gap-2">
      <textarea
        ref={chatTextareaRef}
        value={chatMessage}
        onChange={(e) => onChatMessageChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!sendDisabled) onSendChat();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            chatTextareaRef.current?.blur();
          }
        }}
        placeholder="Message the agent…"
        rows={2}
        className="w-full font-sans text-[13px] text-text-primary placeholder:text-text-quaternary bg-surface-2 border border-border rounded px-3 py-2 resize-none focus:outline-none focus:border-text-tertiary transition-colors"
      />
      {chatError && <p className="text-xs text-status-error px-1">{chatError}</p>}
      <div className="flex gap-2 w-full">
        <Button variant="primary" onClick={onSendChat} disabled={sendDisabled}>
          {chatAgentActive ? (
            "Agent responding…"
          ) : chatSending ? (
            "Sending…"
          ) : (
            <>
              Send <span className="font-mono text-[10px] font-medium opacity-60 ml-3">⌘↵</span>
            </>
          )}
        </Button>
        <Button variant="secondary" onClick={onReturnToWork} disabled={loading}>
          Return to Work
        </Button>
        {canApprove && (
          <Button variant="secondary" onClick={onApprove} disabled={loading}>
            Approve
          </Button>
        )}
      </div>
    </FooterBar>
  );
}
