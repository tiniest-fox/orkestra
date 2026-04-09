// Tests for buildDisplayMessages, buildVirtualItems, and related utilities.

import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/workflow";
import type { DisplayMessage, UserMessage } from "./MessageList";
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

  it("produces agent-header and agent-entry items for agent message with entries", () => {
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
    expect(items[0].kind).toBe("agent-header");
    const entryItems = items.filter((i) => i.kind === "agent-entry");
    expect(entryItems.length).toBeGreaterThan(0);
    // Last entry should have isBlockEnd originally true (before border suppression)
    // After border suppression the last block-end is set to false
    const lastEntry = entryItems[entryItems.length - 1];
    if (lastEntry.kind === "agent-entry") {
      expect(lastEntry.isBlockEnd).toBe(false);
    }
  });

  it("produces only agent-header for empty agent block with no crash", () => {
    const messages: DisplayMessage[] = [{ kind: "agent", entries: [] }];
    // Should not throw, and should produce just the agent-header
    const items = buildVirtualItems(messages, defaultOpts);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("agent-header");
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

  it("suppresses bottom border on the final block (last:border-b-0 behavior)", () => {
    const messages: DisplayMessage[] = [
      { kind: "user", content: "first" },
      { kind: "user", content: "last" },
    ];
    const items = buildVirtualItems(messages, defaultOpts);
    // Find block-end items
    const blockEndItems = items.filter(
      (i) => (i.kind === "user-block" || i.kind === "agent-entry") && i.isBlockEnd,
    );
    // The very last block should have isBlockEnd: false
    const lastBlock = items
      .slice()
      .reverse()
      .find((i) => i.kind === "user-block" || i.kind === "agent-entry");
    expect(lastBlock).toBeDefined();
    if (lastBlock?.kind === "user-block" || lastBlock?.kind === "agent-entry") {
      expect(lastBlock.isBlockEnd).toBe(false);
    }
    // Earlier blocks still have isBlockEnd: true
    expect(blockEndItems.length).toBeGreaterThan(0);
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
});
