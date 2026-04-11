/**
 * Compact one-line log summary for the action column of working tasks.
 *
 * Prefers event-pushed summary data from `log_entry_appended` events, which
 * arrive without polling. Falls back to polling `get_latest_log` every 10s
 * to self-heal after missed events (reconnect, etc.). When a gate is running,
 * shows the latest gate output line instead.
 */

import { useCallback, useEffect, useState } from "react";
import { usePolling } from "../../hooks/usePolling";
import { useTransport } from "../../transport";
import { useTransportListener } from "../../transport/useTransportListener";
import type { LogEntry, WorkflowTaskView } from "../../types/workflow";
import { stripAnsi } from "../../utils/ansi";
import { toolSummary } from "../../utils/toolSummary";

interface LatestLogSummaryProps {
  task: WorkflowTaskView;
}

export function LatestLogSummary({ task }: LatestLogSummaryProps) {
  const transport = useTransport();
  const [entry, setEntry] = useState<LogEntry | null>(null);
  const [eventSummary, setEventSummary] = useState<string | null>(null);

  // Clear event summary when task changes so we don't show stale data.
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.id is an intentional reset trigger, not a value read inside the effect
  useEffect(() => {
    setEventSummary(null);
  }, [task.id]);

  // Subscribe to push events — update immediately without a fetch round-trip.
  useTransportListener("log_entry_appended", (data: { task_id: string; summary?: string }) => {
    if (data.task_id === task.id && data.summary) {
      setEventSummary(data.summary);
    }
  });

  const isGateRunning = task.state.type === "gate_running";

  // Poll as a fallback for missed events (e.g., after reconnect). Longer
  // interval (10s) since event-push covers the common case.
  const fetch = useCallback(async () => {
    if (isGateRunning) return;
    try {
      const result = await transport.call<LogEntry | null>("get_latest_log", {
        task_id: task.id,
      });
      if (result === null || entrySummary(result) !== null) {
        setEntry(result);
      }
    } catch {
      // Silently ignore — the feed row doesn't need to show an error state
    }
  }, [transport, task.id, isGateRunning]);

  usePolling(fetch, 10_000);

  if (isGateRunning) {
    const latestGateIteration = [...task.iterations].reverse().find((i) => i.gate_result);
    const lines = latestGateIteration?.gate_result?.lines ?? [];
    const lastLine = [...lines].reverse().find((l) => l.trim());
    const text =
      stripAnsi(lastLine ?? "")
        .trim()
        .slice(0, 100) || "Running gate check...";
    return (
      <span className="font-mono text-forge-mono-sm text-text-quaternary truncate min-w-0 max-w-full">
        {text}
      </span>
    );
  }

  // Prefer event-pushed summary; fall back to polling-derived summary.
  const displayText = eventSummary ?? (entry ? entrySummary(entry) : null);
  if (!displayText) return null;

  return (
    <span className="font-mono text-forge-mono-sm text-text-quaternary truncate min-w-0 max-w-full">
      {displayText}
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function entrySummary(entry: LogEntry): string | null {
  switch (entry.type) {
    case "tool_use":
      return `${entry.tool} ${toolSummary(entry.input)}`.trimEnd();
    case "subagent_tool_use":
      return `↳ ${entry.tool} ${toolSummary(entry.input)}`.trimEnd();
    case "text": {
      const trimmed = entry.content.trim();
      return trimmed ? trimmed.slice(0, 100) : null;
    }
    default:
      return null;
  }
}
