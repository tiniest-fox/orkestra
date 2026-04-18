// Shared compose area — textarea with auto-resize + send/stop button.
// Used in AssistantDrawer (project/task chat) and AgentTab (agent timeline).

import { ArrowUp, Square } from "lucide-react";
import type React from "react";
import { memo, useEffect, useRef } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";

interface ChatComposeAreaProps {
  value: string;
  onChange: (v: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** Disables the textarea and send button while a request is in flight. */
  sending: boolean;
  /** When true, shows the amber stop button instead of the send button. */
  agentActive: boolean;
  onSend: () => void;
  onStop: () => void;
  placeholder?: string;
  error?: string | null;
  /** Applied to the outer wrapper — use for padding and background. */
  className?: string;
  /** Called after the textarea height has been set (auto-resize settled). */
  onResize?: () => void;
}

export const ChatComposeArea = memo(function ChatComposeArea({
  value,
  onChange,
  textareaRef,
  sending,
  agentActive,
  onSend,
  onStop,
  placeholder = "Send a message…",
  error,
  className = "",
  onResize,
}: ChatComposeAreaProps) {
  const isMobile = useIsMobile();
  const prevHeightRef = useRef(0);

  // Auto-resize textarea to fit content, capped at 120px.
  // Only calls onResize when the height actually changes — not on every keystroke —
  // so callers can scroll to accommodate the new size without spurious snaps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the resize trigger
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, 120);
    el.style.height = `${newHeight}px`;
    if (newHeight !== prevHeightRef.current) {
      prevHeightRef.current = newHeight;
      onResize?.();
    }
  }, [value, onResize]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      if (!agentActive && value.trim() && !sending) onSend();
    }
    if (e.key === "." && e.metaKey && agentActive) {
      e.preventDefault();
      onStop();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      textareaRef.current?.blur();
    }
  }

  return (
    <div className={className}>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder={placeholder}
          rows={1}
          className="flex-1 font-sans text-forge-body bg-surface border border-border rounded-xl px-3.5 py-2.5 outline-none resize-none overflow-hidden text-text-primary placeholder:text-text-quaternary focus:border-text-quaternary transition-colors leading-relaxed disabled:opacity-40 min-h-[42px] max-h-[120px]"
        />
        {agentActive ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className={`shrink-0 h-10 rounded-full bg-status-warning hover:opacity-90 flex items-center justify-center text-white transition-opacity gap-1.5 ${isMobile ? "w-10" : "px-4"}`}
          >
            <Square size={13} fill="currentColor" />
            {!isMobile && (
              <span className="font-mono text-forge-mono-sm font-semibold">
                Stop<span className="opacity-60 ml-1.5">⌘.</span>
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!value.trim() || sending}
            aria-label="Send"
            className={`shrink-0 h-10 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center text-white transition-colors disabled:opacity-30 gap-1.5 ${isMobile ? "w-10" : "px-4"}`}
          >
            <ArrowUp size={15} />
            {!isMobile && (
              <span className="font-mono text-forge-mono-sm font-semibold">
                Send<span className="opacity-60 ml-1.5">↵</span>
              </span>
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="font-sans text-forge-mono-sm text-status-error mt-1.5 px-0.5">{error}</p>
      )}
    </div>
  );
});
