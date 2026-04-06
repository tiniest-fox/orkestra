// Unit tests for buildDisplayMessages utility.

import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/workflow";
import { buildDisplayMessages } from "./MessageList";

// ============================================================================
// Fixtures
// ============================================================================

function makeLog(type: string, content: string): LogEntry {
  return { type, content } as LogEntry;
}

function makeToolUse(tool: string, id: string): LogEntry {
  return { type: "tool_use", tool, id, input: { tool: "other", summary: "" } } as LogEntry;
}

// ============================================================================
// buildDisplayMessages
// ============================================================================

describe("buildDisplayMessages", () => {
  it("returns empty array for empty logs", () => {
    expect(buildDisplayMessages([])).toEqual([]);
  });

  it("returns one UserMessage for a single user_message log", () => {
    const logs = [makeLog("user_message", "Hello!")];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ kind: "user", content: "Hello!" });
  });

  it("keeps consecutive text entries as separate entries in the agent block", () => {
    const logs = [makeLog("text", "Hello, "), makeLog("text", "world!")];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("agent");
    if (messages[0].kind === "agent") {
      expect(messages[0].entries).toHaveLength(2);
      expect(messages[0].entries[0]).toEqual({ type: "text", content: "Hello, " });
      expect(messages[0].entries[1]).toEqual({ type: "text", content: "world!" });
    }
  });

  it("produces alternating User/Agent messages for interleaved logs", () => {
    const logs = [
      makeLog("user_message", "Question?"),
      makeLog("text", "Answer."),
      makeLog("user_message", "Follow up?"),
      makeLog("text", "More detail."),
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ kind: "user", content: "Question?" });
    expect(messages[1].kind).toBe("agent");
    expect(messages[2]).toEqual({ kind: "user", content: "Follow up?" });
    expect(messages[3].kind).toBe("agent");
  });

  it("preserves tool_use entries in agent blocks", () => {
    const toolEntry = makeToolUse("Read", "id-1");
    const logs = [makeLog("text", "Thinking…"), toolEntry, makeLog("text", "Done.")];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("agent");
    if (messages[0].kind === "agent") {
      expect(messages[0].entries).toHaveLength(3);
      expect(messages[0].entries[1]).toEqual(toolEntry);
    }
  });

  it("preserves error entries in agent blocks", () => {
    const errorEntry = { type: "error", message: "something went wrong" } as LogEntry;
    const logs = [makeLog("text", "Working…"), errorEntry];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("agent");
    if (messages[0].kind === "agent") {
      expect(messages[0].entries).toHaveLength(2);
      expect(messages[0].entries[1]).toEqual(errorEntry);
    }
  });

  it("includes trailing entries as a final AgentMessage", () => {
    const logs = [
      makeLog("user_message", "Hi"),
      makeLog("text", "Chunk 1"),
      makeLog("text", "Chunk 2"),
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ kind: "user", content: "Hi" });
    expect(messages[1].kind).toBe("agent");
    if (messages[1].kind === "agent") {
      expect(messages[1].entries).toHaveLength(2);
    }
  });

  it("flushes accumulated entries when a user_message is encountered", () => {
    const logs = [
      makeLog("text", "Part A"),
      makeLog("user_message", "Interrupt"),
      makeLog("text", "Part B"),
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(3);
    expect(messages[0].kind).toBe("agent");
    expect(messages[1]).toEqual({ kind: "user", content: "Interrupt" });
    expect(messages[2].kind).toBe("agent");
  });

  it("produces an AgentMessage block for tool-only entries (no text entries)", () => {
    const logs = [makeToolUse("Read", "id-x")];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("agent");
    if (messages[0].kind === "agent") {
      expect(messages[0].entries).toHaveLength(1);
      expect(messages[0].entries[0]).toEqual(makeToolUse("Read", "id-x"));
    }
  });

  it("splits agent blocks on user_message boundaries", () => {
    const logs = [
      makeLog("text", "Before"),
      makeToolUse("Edit", "id-2"),
      makeLog("user_message", "Continue"),
      makeLog("text", "After"),
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(3);
    expect(messages[0].kind).toBe("agent");
    if (messages[0].kind === "agent") {
      expect(messages[0].entries).toHaveLength(2);
    }
    expect(messages[1]).toEqual({ kind: "user", content: "Continue" });
    expect(messages[2].kind).toBe("agent");
    if (messages[2].kind === "agent") {
      expect(messages[2].entries).toHaveLength(1);
    }
  });
});
