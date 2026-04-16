// Rendering tests for AgentEntry and related components.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LogEntry, WorkflowArtifact, WorkflowResource } from "../../types/workflow";
import type { GroupedLogEntry, SubagentGroup } from "../Logs/useGroupedLogs";
import { AgentEntry } from "./MessageList";

vi.mock("../../hooks/useRichCodeBlocks", () => ({
  useRichCodeBlocks: () => {},
}));

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

// ============================================================================
// artifact_produced — stage-filtered resource rendering
// ============================================================================

const baseArtifact: WorkflowArtifact = {
  name: "plan",
  content: "# Plan",
  stage: "planning",
  created_at: "2026-01-01T00:00:00Z",
  iteration: 1,
};

const artifactEntry: GroupedLogEntry = {
  type: "artifact_produced",
  name: "plan",
  artifact_id: "artifact-1",
  artifact: baseArtifact,
};

describe("AgentEntry — artifact_produced with stage-filtered resources", () => {
  it("renders ResourceItem elements when resources match the artifact's stage", () => {
    const taskResources: Record<string, WorkflowResource> = {
      "screenshot:plan": {
        name: "screenshot:plan",
        url: "https://example.com/plan.png",
        stage: "planning",
        created_at: "2026-01-01T00:01:00Z",
      },
    };
    render(<AgentEntry entry={artifactEntry} taskResources={taskResources} />);
    expect(screen.getByText("screenshot:plan")).toBeDefined();
  });

  it("renders no resource section when no resources match the artifact's stage", () => {
    render(<AgentEntry entry={artifactEntry} taskResources={undefined} />);
    // No resource names should appear — only the ArtifactLogCard header text
    expect(screen.queryByText("screenshot:plan")).toBeNull();
  });

  it("excludes resources from a different stage", () => {
    const taskResources: Record<string, WorkflowResource> = {
      "screenshot:work": {
        name: "screenshot:work",
        url: "https://example.com/work.png",
        stage: "work",
        created_at: "2026-01-01T00:01:00Z",
      },
    };
    render(<AgentEntry entry={artifactEntry} taskResources={taskResources} />);
    // Resource belongs to "work" stage, artifact is "planning" — should not appear
    expect(screen.queryByText("screenshot:work")).toBeNull();
  });
});
