/**
 * Log list - container component for displaying a list of log entries.
 */

import { Terminal } from "lucide-react";
import type { LogEntry } from "../../types/workflow";
import { EmptyState, ErrorState, LoadingState } from "../ui";
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
      <div className="flex items-center justify-center h-full">
        <ErrorState message={error} />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        {isLoading ? (
          <LoadingState message="Loading logs..." />
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
