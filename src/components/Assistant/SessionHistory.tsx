/**
 * SessionHistory - Slide-in panel showing past assistant chat sessions.
 */

import { X } from "lucide-react";
import type { AssistantSession } from "../../types/workflow";
import { Button, Panel } from "../ui";

interface SessionHistoryProps {
  sessions: AssistantSession[];
  activeSessionId: string | null;
  onSelectSession: (session: AssistantSession) => void;
  onClose: () => void;
}

/**
 * Format timestamp as relative time (e.g., "5 min ago", "yesterday").
 */
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? "s" : ""} ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return date.toLocaleDateString();
}

export function SessionHistory({
  sessions,
  activeSessionId,
  onSelectSession,
  onClose,
}: SessionHistoryProps) {
  return (
    <Panel autoFill className="absolute left-0 top-0 bottom-0 w-80 z-10 shadow-panel-elevated">
      <Panel.Header className="flex items-center justify-between">
        <Panel.Title>Session History</Panel.Title>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </Panel.Header>
      <Panel.Body scrollable>
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stone-500 text-sm">
            No previous sessions
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession(session)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  session.id === activeSessionId
                    ? "bg-orange-100 dark:bg-orange-900/30 text-orange-900 dark:text-orange-100"
                    : "hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                <div className="font-medium text-sm truncate">{session.title || "Untitled"}</div>
                <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                  {formatRelativeTime(session.created_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}
