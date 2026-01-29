/**
 * Tool result log entry - displays tool output (only for Task/subagent results).
 */

import { ExpandableContent } from "../shared/ExpandableContent";

interface ToolResultLogEntryProps {
  tool: string;
  content: string;
}

export function ToolResultLogEntry({ tool, content }: ToolResultLogEntryProps) {
  // Only show Task results (subagent output)
  if (tool !== "Task") {
    return null;
  }

  return (
    <div className="py-1.5 ml-6 border-l-2 border-pink-600/50 pl-2">
      <div className="text-xs text-pink-400 mb-1">Subagent result:</div>
      <ExpandableContent content={content} className="ml-6" />
    </div>
  );
}
