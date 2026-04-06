// Tests for buildDisplayMessages and related utilities.

import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/workflow";
import { buildDisplayMessages } from "./MessageList";

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
