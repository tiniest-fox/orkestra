// Unit tests for the groupLogEntries pure function.

import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/workflow";
import { type GroupedLogEntry, type SubagentGroup, groupLogEntries } from "./useGroupedLogs";

// ============================================================================
// Helpers
// ============================================================================

function textEntry(content: string): LogEntry {
  return { type: "text", content };
}

function agentToolUse(id: string, description = "Do something"): LogEntry {
  return { type: "tool_use", tool: "Agent", id, input: { tool: "agent", description } };
}

function bashToolUse(id: string, command = "echo hi"): LogEntry {
  return { type: "tool_use", tool: "Bash", id, input: { tool: "bash", command } };
}

function agentToolResult(toolUseId: string): LogEntry {
  return { type: "tool_result", tool: "Agent", tool_use_id: toolUseId, content: "done" };
}

function bashToolResult(toolUseId: string): LogEntry {
  return { type: "tool_result", tool: "Bash", tool_use_id: toolUseId, content: "output" };
}

function subagentToolUse(id: string, parentTaskId: string): LogEntry {
  return {
    type: "subagent_tool_use",
    tool: "Read",
    id,
    input: { tool: "read", file_path: "/foo.ts" },
    parent_task_id: parentTaskId,
  };
}

function subagentToolResult(toolUseId: string, parentTaskId: string): LogEntry {
  return {
    type: "subagent_tool_result",
    tool: "Read",
    tool_use_id: toolUseId,
    content: "file contents",
    parent_task_id: parentTaskId,
  };
}

function isSubagentGroup(entry: GroupedLogEntry): entry is SubagentGroup {
  return entry.type === "subagent_group";
}

// ============================================================================
// Tests
// ============================================================================

describe("groupLogEntries", () => {
  describe("empty and passthrough cases", () => {
    it("returns empty array for empty input", () => {
      expect(groupLogEntries([])).toEqual([]);
    });

    it("passes through text entries unchanged", () => {
      const logs: LogEntry[] = [textEntry("hello"), textEntry("world")];
      const result = groupLogEntries(logs);
      expect(result).toEqual(logs);
    });

    it("passes through non-agent tool_use entries unchanged", () => {
      const logs: LogEntry[] = [bashToolUse("bash-1")];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(logs[0]);
    });

    it("passes through non-Agent tool_result entries unchanged", () => {
      const logs: LogEntry[] = [bashToolResult("bash-1")];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(logs[0]);
    });

    it("passes through error entries unchanged", () => {
      const logs: LogEntry[] = [{ type: "error", message: "boom" }];
      const result = groupLogEntries(logs);
      expect(result).toEqual(logs);
    });

    it("passes through process_exit entries unchanged", () => {
      const logs: LogEntry[] = [{ type: "process_exit", code: 0 }];
      const result = groupLogEntries(logs);
      expect(result).toEqual(logs);
    });

    it("passes through script entries unchanged", () => {
      const logs: LogEntry[] = [
        { type: "script_start", command: "echo", stage: "build" },
        { type: "script_output", content: "output" },
        { type: "script_exit", code: 0, success: true, timed_out: false },
      ];
      const result = groupLogEntries(logs);
      expect(result).toEqual(logs);
    });
  });

  // ==========================================================================
  // First pass: identify Agent tool_use entries
  // ==========================================================================

  describe("first pass — identify Agent tool_use entries", () => {
    it("replaces agent tool_use with a subagent_group", () => {
      const logs: LogEntry[] = [agentToolUse("task-1")];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("subagent_group");
    });

    it("does not replace non-agent tool_use entries", () => {
      const logs: LogEntry[] = [bashToolUse("bash-1"), agentToolUse("task-1")];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("tool_use");
      expect(result[1].type).toBe("subagent_group");
    });

    it("group taskEntry matches the original agent tool_use", () => {
      const logs: LogEntry[] = [agentToolUse("task-1", "Deploy services")];
      const result = groupLogEntries(logs);
      const group = result[0] as SubagentGroup;
      expect(group.taskEntry.id).toBe("task-1");
      expect(group.taskEntry.tool).toBe("Agent");
      expect(group.taskEntry.input).toEqual({ tool: "agent", description: "Deploy services" });
    });

    it("only entries with input.tool === 'agent' become groups", () => {
      const readToolUse: LogEntry = {
        type: "tool_use",
        tool: "Read",
        id: "read-1",
        input: { tool: "read", file_path: "/foo.ts" },
      };
      const result = groupLogEntries([readToolUse]);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("tool_use");
    });
  });

  // ==========================================================================
  // First pass: identify Agent tool_result entries
  // ==========================================================================

  describe("first pass — Agent tool_result entries", () => {
    it("removes Agent tool_result entries from output", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        agentToolResult("task-1"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("subagent_group");
    });

    it("keeps non-Agent tool_result entries", () => {
      const logs: LogEntry[] = [bashToolUse("bash-1"), bashToolResult("bash-1")];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Second pass: collect subagent entries
  // ==========================================================================

  describe("second pass — collect subagent entries into groups", () => {
    it("collects subagent_tool_use entries under the correct group", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        subagentToolUse("sub-1", "task-1"),
        subagentToolUse("sub-2", "task-1"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(1);
      const group = result[0] as SubagentGroup;
      expect(group.subagentEntries).toHaveLength(2);
      expect(group.subagentEntries[0]).toEqual(logs[1]);
      expect(group.subagentEntries[1]).toEqual(logs[2]);
    });

    it("removes subagent_tool_use entries from top-level output", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        subagentToolUse("sub-1", "task-1"),
      ];
      const result = groupLogEntries(logs);
      const topLevelTypes = result.map((e) => e.type);
      expect(topLevelTypes).not.toContain("subagent_tool_use");
    });

    it("removes subagent_tool_result entries from output", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        subagentToolUse("sub-1", "task-1"),
        subagentToolResult("sub-1", "task-1"),
      ];
      const result = groupLogEntries(logs);
      const topLevelTypes = result.map((e) => e.type);
      expect(topLevelTypes).not.toContain("subagent_tool_result");
    });

    it("ignores subagent entries whose parent_task_id is unknown", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        subagentToolUse("sub-orphan", "unknown-task"),
      ];
      const result = groupLogEntries(logs);
      // orphan subagent is silently dropped; group has no entries
      expect(result).toHaveLength(1);
      const group = result[0] as SubagentGroup;
      expect(group.subagentEntries).toHaveLength(0);
    });

    it("routes subagent entries to the correct group when multiple agents exist", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        agentToolUse("task-2"),
        subagentToolUse("sub-a", "task-1"),
        subagentToolUse("sub-b", "task-2"),
        subagentToolUse("sub-c", "task-2"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(2);
      const group1 = result[0] as SubagentGroup;
      const group2 = result[1] as SubagentGroup;
      expect(group1.taskEntry.id).toBe("task-1");
      expect(group1.subagentEntries).toHaveLength(1);
      expect(group2.taskEntry.id).toBe("task-2");
      expect(group2.subagentEntries).toHaveLength(2);
    });
  });

  // ==========================================================================
  // isComplete (completion marking)
  // ==========================================================================

  describe("isComplete — group completion via tool_result", () => {
    it("marks group as incomplete when no Agent tool_result present", () => {
      const logs: LogEntry[] = [agentToolUse("task-1")];
      const result = groupLogEntries(logs);
      const group = result[0] as SubagentGroup;
      expect(group.isComplete).toBe(false);
    });

    it("marks group as complete when matching Agent tool_result present", () => {
      const logs: LogEntry[] = [agentToolUse("task-1"), agentToolResult("task-1")];
      const result = groupLogEntries(logs);
      const group = result[0] as SubagentGroup;
      expect(group.isComplete).toBe(true);
    });

    it("marks only the completed group when multiple groups exist", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        agentToolResult("task-1"),
        agentToolUse("task-2"),
        // no result for task-2
      ];
      const result = groupLogEntries(logs);
      const group1 = result[0] as SubagentGroup;
      const group2 = result[1] as SubagentGroup;
      expect(group1.isComplete).toBe(true);
      expect(group2.isComplete).toBe(false);
    });

    it("does not mark group complete when tool_result belongs to a different tool_use id", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        agentToolResult("task-99"), // mismatched id
      ];
      const result = groupLogEntries(logs);
      const group = result[0] as SubagentGroup;
      expect(group.isComplete).toBe(false);
    });
  });

  // ==========================================================================
  // Third pass: output ordering and mixed scenarios
  // ==========================================================================

  describe("third pass — output ordering", () => {
    it("preserves relative order of non-agent entries and groups", () => {
      const logs: LogEntry[] = [
        textEntry("before"),
        agentToolUse("task-1"),
        textEntry("after"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(textEntry("before"));
      expect(result[1].type).toBe("subagent_group");
      expect(result[2]).toEqual(textEntry("after"));
    });

    it("handles interleaved entries and groups correctly", () => {
      const logs: LogEntry[] = [
        bashToolUse("bash-1"),
        agentToolUse("task-1"),
        subagentToolUse("sub-1", "task-1"),
        agentToolResult("task-1"),
        bashToolResult("bash-1"),
        textEntry("done"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(4);
      expect(result[0].type).toBe("tool_use"); // bash
      expect(result[1].type).toBe("subagent_group");
      expect(result[2].type).toBe("tool_result"); // bash result
      expect(result[3]).toEqual(textEntry("done"));

      const group = result[1] as SubagentGroup;
      expect(group.isComplete).toBe(true);
      expect(group.subagentEntries).toHaveLength(1);
    });

    it("handles multiple complete groups in sequence", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        subagentToolUse("sub-1a", "task-1"),
        agentToolResult("task-1"),
        agentToolUse("task-2"),
        subagentToolUse("sub-2a", "task-2"),
        subagentToolResult("sub-2a", "task-2"),
        agentToolResult("task-2"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(2);

      const g1 = result[0] as SubagentGroup;
      expect(g1.taskEntry.id).toBe("task-1");
      expect(g1.isComplete).toBe(true);
      expect(g1.subagentEntries).toHaveLength(1);

      const g2 = result[1] as SubagentGroup;
      expect(g2.taskEntry.id).toBe("task-2");
      expect(g2.isComplete).toBe(true);
      // subagent_tool_result is NOT included in subagentEntries (only subagent_tool_use)
      expect(g2.subagentEntries).toHaveLength(1);
    });

    it("returns only passthrough entries when no agent tool_use entries present", () => {
      const logs: LogEntry[] = [
        textEntry("hello"),
        bashToolUse("bash-1"),
        bashToolResult("bash-1"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(3);
      expect(result.every((e) => !isSubagentGroup(e))).toBe(true);
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("edge cases", () => {
    it("handles an agent tool_use with no subagent children", () => {
      const logs: LogEntry[] = [agentToolUse("task-1")];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(1);
      const group = result[0] as SubagentGroup;
      expect(group.subagentEntries).toHaveLength(0);
      expect(group.isComplete).toBe(false);
    });

    it("handles subagent_tool_result entries that appear without a matching subagent_tool_use", () => {
      // result arrives but no corresponding tool_use — should still be filtered out
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        subagentToolResult("sub-orphan", "task-1"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(1);
      const group = result[0] as SubagentGroup;
      expect(group.subagentEntries).toHaveLength(0);
    });

    it("does not include subagent_tool_result entries in group.subagentEntries", () => {
      const logs: LogEntry[] = [
        agentToolUse("task-1"),
        subagentToolUse("sub-1", "task-1"),
        subagentToolResult("sub-1", "task-1"),
      ];
      const result = groupLogEntries(logs);
      const group = result[0] as SubagentGroup;
      // Only subagent_tool_use is pushed in second pass
      expect(group.subagentEntries).toHaveLength(1);
      expect(group.subagentEntries[0].type).toBe("subagent_tool_use");
    });

    it("preserves user_message entries", () => {
      const logs: LogEntry[] = [
        { type: "user_message", content: "Go!", resume_type: "initial" },
        agentToolUse("task-1"),
      ];
      const result = groupLogEntries(logs);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("user_message");
    });
  });
});
