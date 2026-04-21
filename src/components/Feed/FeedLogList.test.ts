// Tests for classifyUser resume type classification.

import { describe, expect, it } from "vitest";
import { classifyUser } from "./FeedLogList";
import type { UserMessage } from "./MessageList";

describe("classifyUser", () => {
  const humanTypes = ["feedback", "answers", "manual_resume", "user_message"] as const;
  const systemTypes = ["initial", "continue", "integration"] as const;

  for (const rt of humanTypes) {
    it(`classifies "${rt}" as You (human)`, () => {
      const msg: UserMessage = { kind: "user", content: "test", resumeType: rt };
      const result = classifyUser(msg);
      expect(result.label).toBe("You");
      expect(result.isHuman).toBe(true);
    });
  }

  for (const rt of systemTypes) {
    it(`classifies "${rt}" as System`, () => {
      const msg: UserMessage = { kind: "user", content: "test", resumeType: rt };
      const result = classifyUser(msg);
      expect(result.label).toBe("System");
      expect(result.isHuman).toBe(false);
    });
  }

  it("classifies undefined resumeType as System", () => {
    const msg: UserMessage = { kind: "user", content: "test" };
    const result = classifyUser(msg);
    expect(result.label).toBe("System");
    expect(result.isHuman).toBe(false);
  });
});
