/**
 * Subagent group - displays a Task tool invocation with its nested subagent tool calls.
 * Shows only the 3 most recent subagent entries with a collapsed count for the rest.
 */

import type { LogEntry, ToolInput } from "../../types/workflow";
import { SubagentToolUseLogEntry } from "./entries/SubagentToolUseLogEntry";
import { ToolUseLogEntry } from "./entries/ToolUseLogEntry";

interface SubagentGroupProps {
  /** The parent Task tool_use entry. */
  taskEntry: { tool: string; id: string; input: ToolInput };
  /** All subagent_tool_use entries for this task. */
  subagentEntries: LogEntry[];
  /** Whether the task has completed (tool_result received). */
  isComplete: boolean;
}

export function SubagentGroup({ taskEntry, subagentEntries, isComplete }: SubagentGroupProps) {
  // Show only the 3 most recent entries
  const last3Entries = subagentEntries.slice(-3);
  const hiddenCount = subagentEntries.length - last3Entries.length;

  return (
    <div>
      <ToolUseLogEntry tool={taskEntry.tool} input={taskEntry.input} isComplete={isComplete} />
      {hiddenCount > 0 && (
        <div className="ml-6 py-1 text-xs text-stone-500 dark:text-stone-400">
          +{hiddenCount} more tool calls
        </div>
      )}
      {last3Entries.map((entry, i) => {
        if (entry.type !== "subagent_tool_use") return null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: subagent logs are append-only
          <SubagentToolUseLogEntry key={i} tool={entry.tool} input={entry.input} />
        );
      })}
    </div>
  );
}
