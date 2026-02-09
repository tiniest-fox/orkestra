/**
 * Log list - container component for displaying a list of log entries.
 */

import { Terminal } from "lucide-react";
import type { LogEntry } from "../../types/workflow";
import { EmptyState } from "../ui";
import { LogEntryView } from "./LogEntryView";
import { SubagentGroup } from "./SubagentGroup";
import { type GroupedLogEntry, useGroupedLogs } from "./useGroupedLogs";

interface LogListProps {
  logs: LogEntry[];
  isLoading?: boolean;
  error?: string | null;
}

function renderLogEntry(entry: GroupedLogEntry, index: number) {
  if (entry.type === "subagent_group") {
    return (
      <SubagentGroup
        key={index}
        taskEntry={entry.taskEntry}
        subagentEntries={entry.subagentEntries}
        isComplete={entry.isComplete}
      />
    );
  }
  return <LogEntryView key={index} entry={entry} />;
}

export function LogList({ logs, isLoading, error }: LogListProps) {
  // Call hooks unconditionally at the top
  const groupedLogs = useGroupedLogs(logs);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        {isLoading ? (
          <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400 text-sm">
            <span className="w-3 h-3 border-2 border-stone-400 dark:border-stone-500 border-t-transparent rounded-full animate-spin" />
            Loading logs...
          </div>
        ) : (
          <EmptyState
            icon={Terminal}
            message="No log entries yet."
            description="Agent activity will appear here."
          />
        )}
      </div>
    );
  }

  return <div className="space-y-0.5">{groupedLogs.map(renderLogEntry)}</div>;
}
