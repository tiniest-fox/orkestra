/**
 * Compact one-line log summary for the action column of working tasks.
 *
 * Polls the latest log entry every 3s and renders a truncated summary of
 * the most recent agent activity (tool call or text output). When a gate is
 * running, shows the latest gate output line instead of polling logs.
 */

import { useCallback, useState } from "react";
import { usePolling } from "../../hooks/usePolling";
import { useTransport } from "../../transport";
import type { LogEntry, WorkflowTaskView } from "../../types/workflow";
import { stripAnsi } from "../../utils/ansi";
import { toolSummary } from "../../utils/toolSummary";

interface LatestLogSummaryProps {
  task: WorkflowTaskView;
}

export function LatestLogSummary({ task }: LatestLogSummaryProps) {
  const transport = useTransport();
  const [entry, setEntry] = useState<LogEntry | null>(null);

  const isGateRunning = task.state.type === "gate_running";

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

  usePolling(fetch, 3000);

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

  if (!entry) return null;

  const summary = entrySummary(entry);
  if (!summary) return null;

  return (
    <span className="font-mono text-forge-mono-sm text-text-quaternary truncate min-w-0 max-w-full">
      {summary}
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
