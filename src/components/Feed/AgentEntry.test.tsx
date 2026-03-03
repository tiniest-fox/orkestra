//! Rendering tests for AgentEntry and related components.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/workflow";
import type { GroupedLogEntry, SubagentGroup } from "../Logs/useGroupedLogs";
import { AgentEntry } from "./AssistantDrawer";

// The closing tag that Claude uses in its XML output.
// Written as concatenation so the file is not misread as a parameter block itself.
const CLOSE = "</" + "antml:parameter>";
const OPEN = '<parameter name="content">';

// ============================================================================
// Fixtures
// ============================================================================

function makeSubagentGroup(toolCount: number): SubagentGroup {
  const subagentEntries: LogEntry[] = Array.from({ length: toolCount }, (_, i) => ({
    type: "subagent_tool_use" as const,
    tool: "Read",
    id: `sub-${i}`,
    input: { tool: "other" as const, summary: `file-${i}.ts` },
    parent_task_id: "task-1",
  }));
  return {
    type: "subagent_group",
    taskEntry: { tool: "Agent", id: "task-1", input: { tool: "agent", description: "do work" } },
    subagentEntries,
    isComplete: true,
  };
}

// ============================================================================
// script_exit branching
// ============================================================================

describe("AgentEntry — script_exit", () => {
  it("renders success indicator for successful exit", () => {
    const entry: GroupedLogEntry = {
      type: "script_exit",
      code: 0,
      success: true,
      timed_out: false,
    };
    render(<AgentEntry entry={entry} />);
    expect(screen.getByText("✓ done")).toBeDefined();
  });

  it("renders failure indicator with exit code for failed exit", () => {
    const entry: GroupedLogEntry = {
      type: "script_exit",
      code: 1,
      success: false,
      timed_out: false,
    };
    render(<AgentEntry entry={entry} />);
    expect(screen.getByText("✗ exit 1")).toBeDefined();
  });

  it("appends timed_out annotation when script timed out", () => {
    const entry: GroupedLogEntry = {
      type: "script_exit",
      code: 124,
      success: false,
      timed_out: true,
    };
    render(<AgentEntry entry={entry} />);
    expect(screen.getByText("✗ exit 124 (timed out)")).toBeDefined();
  });
});

// ============================================================================
// subagent_group — "+N more" counter
// ============================================================================

describe("AgentEntry — subagent_group counter", () => {
  it("shows no counter when tool calls ≤ 2", () => {
    render(<AgentEntry entry={makeSubagentGroup(2)} />);
    expect(screen.queryByText(/\+\d+ tool call/)).toBeNull();
  });

  it("shows '+1 tool call' when 3 tool calls (1 hidden)", () => {
    render(<AgentEntry entry={makeSubagentGroup(3)} />);
    expect(screen.getByText("+1 tool call")).toBeDefined();
  });

  it("shows '+N tool calls' (plural) when multiple are hidden", () => {
    render(<AgentEntry entry={makeSubagentGroup(5)} />);
    expect(screen.getByText("+3 tool calls")).toBeDefined();
  });
});

// ============================================================================
// AssistantTextLine — via text entry
// ============================================================================

describe("AgentEntry — text (AssistantTextLine)", () => {
  it("renders nothing when content is empty after parameter block stripping", () => {
    const entry: GroupedLogEntry = {
      type: "text",
      content: `${OPEN}everything is stripped${CLOSE}`,
    };
    const { container } = render(<AgentEntry entry={entry} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders content with parameter blocks stripped", () => {
    const entry: GroupedLogEntry = {
      type: "text",
      content: `Hello ${OPEN}STRIP ME${CLOSE} world`,
    };
    render(<AgentEntry entry={entry} />);
    expect(screen.getByText(/Hello.*world/)).toBeDefined();
  });

  it("renders nothing when content is empty after question block stripping", () => {
    const entry: GroupedLogEntry = {
      type: "text",
      content: "```orkestra-questions\n[]\n```",
    };
    const { container } = render(<AgentEntry entry={entry} />);
    expect(container.firstChild).toBeNull();
  });
});
