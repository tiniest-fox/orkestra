/**
 * Tool result log entry - no longer renders anything.
 * Task results are shown as completion indicators on the parent Task tool_use entry.
 */

interface ToolResultLogEntryProps {
  tool: string;
  content: string;
}

export function ToolResultLogEntry(_props: ToolResultLogEntryProps) {
  // No longer render task results - completion is shown on the task header
  return null;
}
