/**
 * Compact one-line log summary for the action column of working tasks.
 *
 * Polls the latest log entry every 3s and renders a truncated summary of
 * the most recent agent activity (tool call or text output).
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { usePolling } from "../../hooks/usePolling";
import type { LogEntry, WorkflowTaskView } from "../../types/workflow";
import { toolSummary } from "../../utils/toolSummary";

interface LatestLogSummaryProps {
  task: WorkflowTaskView;
}

export function LatestLogSummary({ task }: LatestLogSummaryProps) {
  const [entry, setEntry] = useState<LogEntry | null>(null);

  const fetch = useCallback(async () => {
    try {
      const result = await invoke<LogEntry | null>("workflow_get_latest_log", {
        taskId: task.id,
      });
      setEntry(result);
    } catch {
      // Silently ignore — the feed row doesn't need to show an error state
    }
  }, [task.id]);

  usePolling(fetch, 3000);

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
    case "text": {
      const trimmed = entry.content.trim();
      return trimmed ? trimmed.slice(0, 100) : null;
    }
    case "script_output":
      return entry.content.trim().slice(0, 100) || null;
    default:
      return null;
  }
}
