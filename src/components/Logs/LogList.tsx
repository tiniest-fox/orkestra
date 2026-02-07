/**
 * Log list - container component for displaying a list of log entries.
 */

import { Terminal } from "lucide-react";
import type { LogEntry } from "../../types/workflow";
import { EmptyState } from "../ui";
import { LogEntryView } from "./LogEntryView";

interface LogListProps {
  logs: LogEntry[];
  isLoading?: boolean;
  error?: string | null;
}

export function LogList({ logs, isLoading, error }: LogListProps) {
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
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <span className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
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

  return (
    <div className="space-y-0.5">
      {logs.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: logs are append-only without stable IDs
        <LogEntryView key={i} entry={entry} />
      ))}
    </div>
  );
}
