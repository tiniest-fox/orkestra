//! Unit tests for buildDisplayMessages utility in AssistantDrawer.

import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/workflow";
import { buildDisplayMessages } from "./AssistantDrawer";

// ============================================================================
// Fixtures
// ============================================================================

function makeLog(type: string, content: string): LogEntry {
  return { type, content } as LogEntry;
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

  it("merges consecutive text logs into one AgentMessage", () => {
    const logs = [makeLog("text", "Hello, "), makeLog("text", "world!")];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ kind: "agent", content: "Hello, world!" });
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
    expect(messages[1]).toEqual({ kind: "agent", content: "Answer." });
    expect(messages[2]).toEqual({ kind: "user", content: "Follow up?" });
    expect(messages[3]).toEqual({ kind: "agent", content: "More detail." });
  });

  it("skips non-text log types (tool_use, tool_result, error)", () => {
    const logs = [
      makeLog("tool_use", "{}"),
      makeLog("tool_result", "result"),
      makeLog("error", "something went wrong"),
    ];
    expect(buildDisplayMessages(logs)).toEqual([]);
  });

  it("includes trailing text logs as a final AgentMessage", () => {
    const logs = [
      makeLog("user_message", "Hi"),
      makeLog("text", "Chunk 1 "),
      makeLog("text", "Chunk 2"),
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ kind: "user", content: "Hi" });
    expect(messages[1]).toEqual({ kind: "agent", content: "Chunk 1 Chunk 2" });
  });

  it("flushes accumulated text chunks when a user_message is encountered", () => {
    const logs = [
      makeLog("text", "Part A"),
      makeLog("user_message", "Interrupt"),
      makeLog("text", "Part B"),
    ];
    const messages = buildDisplayMessages(logs);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ kind: "agent", content: "Part A" });
    expect(messages[1]).toEqual({ kind: "user", content: "Interrupt" });
    expect(messages[2]).toEqual({ kind: "agent", content: "Part B" });
  });
});
