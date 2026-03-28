// Tests for feedGrouping — chat mode and interactive task classification.

import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import { groupTasksForFeed } from "./feedGrouping";

describe("groupTasksForFeed — chat mode classification", () => {
  it("places chatting tasks in needs_review section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { is_chatting: true, is_working: true },
    });
    const result = groupTasksForFeed([task]);
    const needsReview = result.sections.find((s) => s.name === "needs_review");
    expect(needsReview?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places interactive tasks in needs_review section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "interactive", stage: "work" },
      derived: { is_interactive: true },
    });
    const result = groupTasksForFeed([task]);
    const needsReview = result.sections.find((s) => s.name === "needs_review");
    expect(needsReview?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places chat_agent_active tasks in needs_review section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { chat_agent_active: true, is_working: true },
    });
    const result = groupTasksForFeed([task]);
    const needsReview = result.sections.find((s) => s.name === "needs_review");
    expect(needsReview?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("does not double-classify chatting + needs_review tasks", () => {
    const task = createMockWorkflowTaskView({
      derived: { is_chatting: true, needs_review: true },
    });
    const result = groupTasksForFeed([task]);
    const needsReview = result.sections.find((s) => s.name === "needs_review");
    expect(needsReview?.tasks).toHaveLength(1);
  });
});
