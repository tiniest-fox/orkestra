/**
 * Hook for grouping subagent log entries under their parent Agent tool invocations.
 */

import { useMemo } from "react";
import type { LogEntry, ToolInput } from "../../types/workflow";

export interface SubagentGroup {
  type: "subagent_group";
  taskEntry: { tool: string; id: string; input: ToolInput };
  subagentEntries: LogEntry[];
  isComplete: boolean;
}

export type GroupedLogEntry = LogEntry | SubagentGroup;

interface TaskToolUseEntry {
  type: "tool_use";
  tool: string;
  id: string;
  input: ToolInput;
}

interface TaskGroup {
  taskEntry: TaskToolUseEntry;
  subagentEntries: LogEntry[];
  hasResult: boolean;
}

/**
 * Pure function that groups subagent tool calls under their parent Agent tool_use entries.
 * Returns an array where Agent tool_use entries are replaced with groups containing their subagent children.
 */
export function groupLogEntries(logs: LogEntry[]): GroupedLogEntry[] {
  // Build a map of Task tool_use IDs to their subagent entries and completion status
  const taskGroups = new Map<string, TaskGroup>();
  const taskToolResultIds = new Set<string>();

  // First pass: identify Agent tool_use entries and their results
  for (const entry of logs) {
    if (entry.type === "tool_use" && entry.input.tool === "agent") {
      taskGroups.set(entry.id, {
        taskEntry: entry as TaskToolUseEntry,
        subagentEntries: [],
        hasResult: false,
      });
    }
    if (entry.type === "tool_result" && entry.tool === "Agent") {
      taskToolResultIds.add(entry.tool_use_id);
    }
  }

  // Second pass: collect subagent entries and mark completion
  for (const entry of logs) {
    if (entry.type === "subagent_tool_use") {
      const group = taskGroups.get(entry.parent_task_id);
      if (group) {
        group.subagentEntries.push(entry);
      }
    }
  }

  // Mark groups as complete if they have results
  for (const [taskId, group] of taskGroups) {
    if (taskToolResultIds.has(taskId)) {
      group.hasResult = true;
    }
  }

  // Third pass: build output array, replacing Task tool_use entries with groups
  const result: GroupedLogEntry[] = [];

  for (const entry of logs) {
    // Skip Agent tool_result entries (no longer rendered)
    if (entry.type === "tool_result" && entry.tool === "Agent") {
      continue;
    }

    // Skip subagent_tool_use entries (rendered inside groups)
    if (entry.type === "subagent_tool_use") {
      continue;
    }

    // Skip subagent_tool_result entries (already hidden)
    if (entry.type === "subagent_tool_result") {
      continue;
    }

    // Replace Agent tool_use with subagent group
    if (entry.type === "tool_use" && entry.input.tool === "agent") {
      const group = taskGroups.get(entry.id);
      if (group) {
        result.push({
          type: "subagent_group",
          taskEntry: entry,
          subagentEntries: group.subagentEntries,
          isComplete: group.hasResult,
        });
      }
      continue;
    }

    // Pass through all other entries
    result.push(entry);
  }

  return result;
}

/**
 * Groups subagent tool calls under their parent Agent tool_use entries.
 * Returns a memoized array where Agent tool_use entries are replaced with groups containing their subagent children.
 */
export function useGroupedLogs(logs: LogEntry[]): GroupedLogEntry[] {
  return useMemo(() => groupLogEntries(logs), [logs]);
}
