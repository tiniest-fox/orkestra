// Tests for feedGrouping — interrupted/failed/blocked and PR-state classification.

import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import { groupTasksForFeed } from "./feedGrouping";

describe("groupTasksForFeed — PR-state classification for done tasks", () => {
  it("places done task with pr_url but no prStates map in open_pr", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const result = groupTasksForFeed([task]);
    const section = result.sections.find((s) => s.name === "open_pr");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task without pr_url in ready_to_ship", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
    });
    const result = groupTasksForFeed([task]);
    const section = result.sections.find((s) => s.name === "ready_to_ship");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with merged PR in merged_pr section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map([[task.id, "merged"]]);
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "merged_pr");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with closed PR in closed_pr section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map([[task.id, "closed"]]);
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "closed_pr");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with open PR in open_pr section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map([[task.id, "open"]]);
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "open_pr");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places done task with pr_url but no prStates entry in open_pr section", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/1",
    });
    const prStates = new Map<string, string>(); // empty map, no entry for this task
    const result = groupTasksForFeed([task], prStates);
    const section = result.sections.find((s) => s.name === "open_pr");
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

  it("returns sections in correct order: needs_review, in_progress, ready_to_ship, open_pr, merged_pr, closed_pr, completed", () => {
    const result = groupTasksForFeed([]);
    const names = result.sections.map((s) => s.name);
    expect(names).toEqual([
      "needs_review",
      "in_progress",
      "ready_to_ship",
      "open_pr",
      "merged_pr",
      "closed_pr",
      "completed",
    ]);
  });
});

describe("groupTasksForFeed — chat task classification", () => {
  it("places chat task with assistant_active=true in in_progress", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { assistant_active: true },
    });
    const result = groupTasksForFeed([task]);
    const section = result.sections.find((s) => s.name === "in_progress");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  it("places chat task with assistant_active=false in needs_review", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { assistant_active: false },
    });
    const result = groupTasksForFeed([task]);
    const section = result.sections.find((s) => s.name === "needs_review");
    expect(section?.tasks).toContainEqual(expect.objectContaining({ id: task.id }));
  });
});
