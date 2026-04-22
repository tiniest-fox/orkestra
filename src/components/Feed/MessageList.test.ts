// Tests for buildDisplayMessages, buildVirtualItems, and related utilities.

import { describe, expect, it } from "vitest";
import type { LogEntry, WorkflowArtifact } from "../../types/workflow";
import type { ArtifactContext, DisplayMessage, UserMessage } from "./MessageList";
import { buildDisplayMessages, buildVirtualItems } from "./MessageList";

describe("buildDisplayMessages", () => {
  it("propagates resume_type from LogEntry to UserMessage.resumeType", () => {
    const logs: LogEntry[] = [{ type: "user_message", content: "hello", resume_type: "feedback" }];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("user");
    if (messages[0].kind === "user") {
      expect(messages[0].resumeType).toBe("feedback");
    }
  });

  it("omits resumeType when resume_type is undefined", () => {
    const logs: LogEntry[] = [{ type: "user_message", content: "hello" }];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    if (messages[0].kind === "user") {
      expect(messages[0].resumeType).toBeUndefined();
    }
  });

  it("propagates sections from initial LogEntry to UserMessage", () => {
    const sections = [{ label: "Feedback to Address", content: "Please add error handling." }];
    const logs: LogEntry[] = [
      { type: "user_message", content: "hello", resume_type: "initial", sections },
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    if (messages[0].kind === "user") {
      expect(messages[0].sections).toEqual(sections);
    }
  });

  it("omits sections when sections array is empty", () => {
    const logs: LogEntry[] = [
      { type: "user_message", content: "hello", resume_type: "feedback", sections: [] },
    ];
    const messages = buildDisplayMessages(logs);
    if (messages[0].kind === "user") {
      expect(messages[0].sections).toBeUndefined();
    }
  });

  it("filters out gate_failure user messages", () => {
    const logs: LogEntry[] = [
      { type: "user_message", content: "start", resume_type: "initial" },
      { type: "text", content: "working..." },
      { type: "user_message", content: "gate error", resume_type: "gate_failure" },
    ];
    const messages = buildDisplayMessages(logs);
    // gate_failure message should be excluded; only the initial user message remains
    expect(messages.filter((m) => m.kind === "user")).toHaveLength(1);
    const userMsg = messages.find((m) => m.kind === "user");
    if (userMsg?.kind === "user") {
      expect(userMsg.resumeType).toBe("initial");
    }
  });

  it("groups consecutive non-user entries into agent messages", () => {
    const logs: LogEntry[] = [
      { type: "user_message", content: "start", resume_type: "initial" },
      { type: "text", content: "thinking" },
      { type: "tool_use", tool: "Read", id: "1", input: { tool: "read", file_path: "/a.ts" } },
      { type: "user_message", content: "next", resume_type: "feedback" },
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(3);
    expect(messages[0].kind).toBe("user");
    expect(messages[1].kind).toBe("agent");
    if (messages[1].kind === "agent") {
      expect(messages[1].entries).toHaveLength(2);
    }
    expect(messages[2].kind).toBe("user");
  });
});

describe("buildVirtualItems", () => {
  const defaultOpts = {
    agentLabel: "Agent",
    userLabel: "You",
    isAgentRunning: false,
  };

  it("produces user-block for user messages", () => {
    const messages: DisplayMessage[] = [{ kind: "user", content: "hello" }];
    const items = buildVirtualItems(messages, defaultOpts);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("user-block");
    if (items[0].kind === "user-block") {
      expect(items[0].label).toBe("You");
    }
  });

  it("produces agent-entry items for agent message with entries", () => {
    const messages: DisplayMessage[] = [
      {
        kind: "agent",
        entries: [
          { type: "text", content: "thinking" },
          { type: "tool_use", tool: "Read", id: "1", input: { tool: "read", file_path: "/a.ts" } },
        ],
      },
    ];
    const items = buildVirtualItems(messages, defaultOpts);
    expect(items[0].kind).toBe("agent-entry");
    const entryItems = items.filter((i) => i.kind === "agent-entry");
    expect(entryItems.length).toBeGreaterThan(0);
    const lastEntry = entryItems[entryItems.length - 1];
    if (lastEntry.kind === "agent-entry") {
      expect(lastEntry.isBlockEnd).toBe(true);
    }
  });

  it("produces no items for empty agent block without crashing", () => {
    const messages: DisplayMessage[] = [{ kind: "agent", entries: [] }];
    // Should not throw, and should produce no items (no header since agent-header was removed)
    const items = buildVirtualItems(messages, defaultOpts);
    expect(items).toHaveLength(0);
  });

  it("places extra item after last agent block entries", () => {
    const extra = "extra content";
    const messages: DisplayMessage[] = [
      { kind: "user", content: "hi" },
      { kind: "agent", entries: [{ type: "text", content: "response" }] },
    ];
    const items = buildVirtualItems(messages, { ...defaultOpts, lastAgentExtra: extra });
    const extraIndex = items.findIndex((i) => i.kind === "extra");
    expect(extraIndex).toBeGreaterThan(-1);
    const extraItem = items[extraIndex];
    if (extraItem.kind === "extra") {
      expect(extraItem.content).toBe(extra);
    }
    // extra comes after all agent-entry items
    const lastEntryIndex = items.reduce(
      (acc, item, idx) => (item.kind === "agent-entry" ? idx : acc),
      -1,
    );
    expect(extraIndex).toBeGreaterThan(lastEntryIndex);
  });

  it("appends spinner when isAgentRunning is true", () => {
    const messages: DisplayMessage[] = [{ kind: "user", content: "hi" }];
    const items = buildVirtualItems(messages, { ...defaultOpts, isAgentRunning: true });
    expect(items[items.length - 1].kind).toBe("spinner");
  });

  it("sets isBlockEnd: true on all user blocks", () => {
    const messages: DisplayMessage[] = [
      { kind: "user", content: "first" },
      { kind: "user", content: "last" },
    ];
    const items = buildVirtualItems(messages, defaultOpts);
    const userBlocks = items.filter((i) => i.kind === "user-block");
    expect(userBlocks.length).toBe(2);
    for (const block of userBlocks) {
      if (block.kind === "user-block") {
        expect(block.isBlockEnd).toBe(true);
      }
    }
  });

  it("uses classifyUser callback for label and isHuman", () => {
    const classifyUser = (_msg: UserMessage) => ({ label: "System", isHuman: false });
    const messages: DisplayMessage[] = [{ kind: "user", content: "sys msg" }];
    const items = buildVirtualItems(messages, { ...defaultOpts, classifyUser });
    expect(items[0].kind).toBe("user-block");
    if (items[0].kind === "user-block") {
      expect(items[0].label).toBe("System");
      expect(items[0].isHuman).toBe(false);
    }
  });

  // artifact_produced entries

  it("produces agent-entry items for artifact_produced log entries", () => {
    const artifactEntry: LogEntry = {
      type: "artifact_produced",
      name: "plan",
      artifact_id: "artifact-1",
      artifact: {
        name: "plan",
        content: "# Plan",
        stage: "planning",
        created_at: "2026-01-01T00:00:00Z",
        iteration: 1,
      },
    };
    const messages: DisplayMessage[] = [{ kind: "agent", entries: [artifactEntry] }];
    const items = buildVirtualItems(messages, defaultOpts);
    const entryItems = items.filter((i) => i.kind === "agent-entry");
    expect(entryItems.length).toBeGreaterThan(0);
  });

  it("threads artifactContext into agent-entry items with artifact_produced entries", () => {
    const artifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "planning",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    const artifactEntry: LogEntry = {
      type: "artifact_produced",
      name: "plan",
      artifact_id: "artifact-42",
      artifact,
    };
    const messages: DisplayMessage[] = [{ kind: "agent", entries: [artifactEntry] }];
    const artifactContext: ArtifactContext = {
      actions: {
        needsReview: true,
        verdict: undefined,
        rejectionTarget: undefined,
        onApprove: () => Promise.resolve(),
        loading: false,
      },
    };
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      artifactContext,
      latestArtifactId: "artifact-42",
    });
    // The latest artifact with a matching latestArtifactId is split into artifact-header + artifact-body
    const headerItem = items.find((i) => i.kind === "artifact-header");
    expect(headerItem).toBeDefined();
    if (headerItem?.kind === "artifact-header") {
      expect(headerItem.artifactContext).toBe(artifactContext);
    }
  });

  // Gate entry absorption tests

  it("gate entries after the latest artifact are excluded from virtual item output", () => {
    const artifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "work",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    const entries: LogEntry[] = [
      { type: "artifact_produced", name: "plan", artifact_id: "art-1", artifact },
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "Running tests..." },
      { type: "gate_completed", exit_code: 1, passed: false },
    ];
    const messages: DisplayMessage[] = [{ kind: "agent", entries }];
    const artifactContext: ArtifactContext = {
      gateEntries: [
        { type: "gate_started", command: "checks.sh" },
        { type: "gate_output", content: "Running tests..." },
        { type: "gate_completed", exit_code: 1, passed: false },
      ],
    };
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      latestArtifactId: "art-1",
      artifactContext,
    });
    // Gate entries must not appear as standalone agent-entry items
    const agentEntries = items.filter((i) => i.kind === "agent-entry");
    const hasGateEntry = agentEntries.some(
      (i) =>
        i.kind === "agent-entry" &&
        (i.entry.type === "gate_started" ||
          i.entry.type === "gate_output" ||
          i.entry.type === "gate_completed"),
    );
    expect(hasGateEntry).toBe(false);
  });

  it("gate entries are attached to the artifact-body item", () => {
    const artifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "work",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    const gateEntries: LogEntry[] = [
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "output" },
      { type: "gate_completed", exit_code: 0, passed: true },
    ];
    const entries: LogEntry[] = [
      { type: "artifact_produced", name: "plan", artifact_id: "art-1", artifact },
      ...gateEntries,
    ];
    const messages: DisplayMessage[] = [{ kind: "agent", entries }];
    const artifactContext: ArtifactContext = {
      gateEntries,
      isGateRunning: false,
      gatePassed: true,
    };
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      latestArtifactId: "art-1",
      artifactContext,
    });
    const bodyItem = items.find((i) => i.kind === "artifact-body");
    expect(bodyItem).toBeDefined();
    if (bodyItem?.kind === "artifact-body") {
      expect(bodyItem.gateEntries).toHaveLength(3);
      expect(bodyItem.gatePassed).toBe(true);
      expect(bodyItem.isGateRunning).toBe(false);
    }
  });

  it("artifact-body item has gatePassed=false and isGateRunning=false when gate failed", () => {
    const artifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "work",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    const gateEntries: LogEntry[] = [
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "FAILED: tests failed" },
      { type: "gate_completed", exit_code: 1, passed: false },
    ];
    const entries: LogEntry[] = [
      { type: "artifact_produced", name: "plan", artifact_id: "art-1", artifact },
      ...gateEntries,
    ];
    const messages: DisplayMessage[] = [{ kind: "agent", entries }];
    const artifactContext: ArtifactContext = {
      gateEntries,
      isGateRunning: false,
      gatePassed: false,
    };
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      latestArtifactId: "art-1",
      artifactContext,
    });
    const bodyItem = items.find((i) => i.kind === "artifact-body");
    expect(bodyItem).toBeDefined();
    if (bodyItem?.kind === "artifact-body") {
      expect(bodyItem.gateEntries).toHaveLength(3);
      expect(bodyItem.gatePassed).toBe(false);
      expect(bodyItem.isGateRunning).toBe(false);
    }
  });

  it("gate entries without a preceding artifact render normally as agent-entry items", () => {
    const entries: LogEntry[] = [
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "output" },
      { type: "gate_completed", exit_code: 0, passed: true },
    ];
    const messages: DisplayMessage[] = [{ kind: "agent", entries }];
    const items = buildVirtualItems(messages, defaultOpts);
    const agentEntries = items.filter((i) => i.kind === "agent-entry");
    expect(agentEntries.length).toBeGreaterThan(0);
  });

  it("gate entries before the latest artifact render normally", () => {
    const artifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "work",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    // Gate entries come BEFORE the artifact_produced
    const entries: LogEntry[] = [
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_completed", exit_code: 0, passed: true },
      { type: "artifact_produced", name: "plan", artifact_id: "art-1", artifact },
    ];
    const messages: DisplayMessage[] = [{ kind: "agent", entries }];
    const artifactContext: ArtifactContext = {};
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      latestArtifactId: "art-1",
      artifactContext,
    });
    // Gate entries before the artifact should still appear as agent-entry items
    const agentEntries = items.filter((i) => i.kind === "agent-entry");
    const hasGateEntry = agentEntries.some(
      (i) =>
        i.kind === "agent-entry" &&
        (i.entry.type === "gate_started" || i.entry.type === "gate_completed"),
    );
    expect(hasGateEntry).toBe(true);
  });

  it("collects gate entries following a superseded artifact into gateEntries on the agent-entry item", () => {
    const artifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "work",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    const latestArtifact: WorkflowArtifact = { ...artifact, iteration: 2 };
    const entries: LogEntry[] = [
      { type: "artifact_produced", name: "plan", artifact_id: "art-1", artifact },
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "output" },
      { type: "gate_completed", exit_code: 1, passed: false },
      { type: "artifact_produced", name: "plan", artifact_id: "art-2", artifact: latestArtifact },
    ];
    const messages: DisplayMessage[] = [{ kind: "agent", entries }];
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      latestArtifactId: "art-2",
    });
    // The superseded artifact agent-entry should carry the gate entries
    const supersededEntry = items.find(
      (i) => i.kind === "agent-entry" && i.entry.type === "artifact_produced",
    );
    expect(supersededEntry).toBeDefined();
    if (supersededEntry?.kind === "agent-entry") {
      expect(supersededEntry.gateEntries).toHaveLength(3);
      expect(supersededEntry.gateEntries?.[0].type).toBe("gate_started");
      expect(supersededEntry.gateEntries?.[2].type).toBe("gate_completed");
    }
  });

  it("gate entries following a superseded artifact do not appear as standalone agent-entry items", () => {
    const artifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "work",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    const latestArtifact: WorkflowArtifact = { ...artifact, iteration: 2 };
    const entries: LogEntry[] = [
      { type: "artifact_produced", name: "plan", artifact_id: "art-1", artifact },
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "output" },
      { type: "gate_completed", exit_code: 1, passed: false },
      { type: "artifact_produced", name: "plan", artifact_id: "art-2", artifact: latestArtifact },
    ];
    const messages: DisplayMessage[] = [{ kind: "agent", entries }];
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      latestArtifactId: "art-2",
    });
    // Gate entries must not appear as standalone agent-entry items
    const standaloneGateItems = items.filter(
      (i) =>
        i.kind === "agent-entry" &&
        (i.entry.type === "gate_started" ||
          i.entry.type === "gate_output" ||
          i.entry.type === "gate_completed"),
    );
    expect(standaloneGateItems).toHaveLength(0);
  });

  it("passes latestArtifactId so superseded entries can be identified", () => {
    const baseArtifact: WorkflowArtifact = {
      name: "plan",
      content: "# Plan",
      stage: "planning",
      created_at: "2026-01-01T00:00:00Z",
      iteration: 1,
    };
    const olderEntry: LogEntry = {
      type: "artifact_produced",
      name: "plan",
      artifact_id: "artifact-1",
      artifact: baseArtifact,
    };
    const newerEntry: LogEntry = {
      type: "artifact_produced",
      name: "plan",
      artifact_id: "artifact-2",
      artifact: { ...baseArtifact, iteration: 2 },
    };
    const messages: DisplayMessage[] = [{ kind: "agent", entries: [olderEntry, newerEntry] }];
    const items = buildVirtualItems(messages, {
      ...defaultOpts,
      latestArtifactId: "artifact-2",
    });
    const entryItems = items.filter((i) => i.kind === "agent-entry");
    // Both entries carry the latestArtifactId so AgentEntry can differentiate
    for (const item of entryItems) {
      if (item.kind === "agent-entry") {
        expect(item.latestArtifactId).toBe("artifact-2");
      }
    }
  });
});
