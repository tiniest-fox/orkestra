//! Run tab — terminal-like log display with Start/Stop controls for the run script.

import { ArrowDown, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RunStatus } from "../../../../hooks/useRunScript";
import { AnsiText } from "../../../../utils/ansi";

// ============================================================================
// Types
// ============================================================================

interface RunTabProps {
  status: RunStatus;
  lines: string[];
  loading: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

// ============================================================================
// Component
// ============================================================================

export function RunTab({ status, lines, loading, error, start, stop }: RunTabProps) {
  // -- Auto-scroll --
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 20;
    isAtBottomRef.current = nearBottom;
    setIsAtBottom(nearBottom);
  }, []);

  // Auto-scroll when new lines arrive, if at bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lines triggers the effect; scrollToBottom reads isAtBottomRef
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [lines, scrollToBottom]);

  // -- Status text --
  const statusText = (() => {
    if (status.running) return "Running";
    if (status.exit_code !== null) {
      return status.exit_code === 0 ? "Exited (code 0)" : `Exited (code ${status.exit_code})`;
    }
    return "Stopped";
  })();

  const statusClass = status.running
    ? "text-status-success"
    : status.exit_code !== null && status.exit_code !== 0
      ? "text-status-error"
      : "text-text-tertiary";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Control bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border">
        {status.running ? (
          <button
            type="button"
            onClick={stop}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium text-status-success bg-status-success/10 hover:bg-status-success/20 transition-colors disabled:opacity-50"
          >
            <Square size={11} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium text-text-secondary bg-surface-2 hover:bg-surface-3 transition-colors disabled:opacity-50"
          >
            <Play size={11} fill="currentColor" />
            Start
          </button>
        )}
        <span className={`text-[11px] font-medium ${statusClass}`}>{statusText}</span>
        {error && (
          <span className="text-[11px] text-status-error ml-auto truncate max-w-xs" title={error}>
            {error}
          </span>
        )}
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto relative bg-surface-1"
      >
        {lines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[12px] text-text-quaternary font-mono">
            No output yet. Click Start to run the script.
          </div>
        ) : (
          <pre className="p-4 text-[12px] font-mono whitespace-pre-wrap text-text-secondary">
            {lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only, index is stable
              <div key={i}>
                <AnsiText text={line} />
              </div>
            ))}
            {status.exit_code !== null && (
              <div
                className={`mt-2 text-[11px] font-medium ${
                  status.exit_code === 0 ? "text-text-tertiary" : "text-status-error"
                }`}
              >
                {status.exit_code === 0
                  ? "Process exited successfully."
                  : `Process exited with code ${status.exit_code}`}
              </div>
            )}
          </pre>
        )}

        {/* Scroll-to-bottom indicator */}
        {!isAtBottom && lines.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1 px-2 py-1 rounded bg-surface-3 text-text-secondary text-[11px] hover:bg-surface-2 transition-colors shadow-sm"
          >
            <ArrowDown size={10} />
            scroll
          </button>
        )}
      </div>
    </div>
  );
}
