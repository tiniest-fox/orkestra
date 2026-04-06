// Tests for feedGrouping — chat mode, interactive task, and PR-state classification.

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

describe("groupTasksForFeed — PR-state classification for done tasks", () => {
  it("places done task with no prStates map in ready_to_ship", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const result = groupTasksForFeed([task]);
    const section = result.sections.find((s) => s.name === "ready_to_ship");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with merged PR in merged section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map([[task.id, "merged"]]);
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "merged");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with closed PR in closed section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map([[task.id, "closed"]]);
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "closed");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with open PR in ready_to_ship", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map([[task.id, "open"]]);
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "ready_to_ship");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with pr_url but no prStates entry in ready_to_ship", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map<string, string>(); // empty map, no entry for this task
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "ready_to_ship");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places integrating task in ready_to_ship regardless of prStates", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "integrating" },
    });
    const prStates = new Map([[task.id, "merged"]]);
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "ready_to_ship");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("returns sections in correct order: needs_review, in_progress, ready_to_ship, merged, closed, completed", () => {
    const result = groupTasksForFeed([]);
    const names = result.sections.map((s) => s.name);
    expect(names).toEqual([
      "needs_review",
      "in_progress",
      "ready_to_ship",
      "merged",
      "closed",
      "completed",
    ]);
  });
});
