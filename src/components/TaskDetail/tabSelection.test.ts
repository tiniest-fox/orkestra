import { describe, expect, it } from "vitest";
import { createMockArtifact, createMockWorkflowTaskView } from "../../test/mocks/fixtures";
import { buildTabs, smartDefaultTab } from "./tabSelection";

describe("buildTabs", () => {
  it("includes PR tab when task has pr_url", () => {
    const task = createMockWorkflowTaskView({
      pr_url: "https://github.com/test/repo/pull/42",
    });
    const tabs = buildTabs(task);
    expect(tabs.some((t) => t.label === "PR")).toBe(true);
  });

  it("excludes PR tab when task has no pr_url", () => {
    const task = createMockWorkflowTaskView({ pr_url: undefined });
    const tabs = buildTabs(task);
    expect(tabs.some((t) => t.label === "PR")).toBe(false);
  });

  it("includes Subtasks tab when task has subtask_progress", () => {
    const task = createMockWorkflowTaskView({
      derived: {
        subtask_progress: {
          total: 3,
          done: 1,
          failed: 0,
          blocked: 0,
          interrupted: 0,
          has_questions: 0,
          needs_review: 0,
          working: 1,
          waiting: 1,
        },
      },
    });
    const tabs = buildTabs(task);
    expect(tabs.some((t) => t.label === "Subtasks")).toBe(true);
  });

  it("excludes Subtasks tab when task has no subtask_progress", () => {
    const task = createMockWorkflowTaskView();
    const tabs = buildTabs(task);
    expect(tabs.some((t) => t.label === "Subtasks")).toBe(false);
  });

  it("includes Artifacts tab when task has artifacts", () => {
    const task = createMockWorkflowTaskView({
      artifacts: { plan: createMockArtifact("plan", "...") },
    });
    const tabs = buildTabs(task);
    expect(tabs.some((t) => t.label === "Artifacts")).toBe(true);
  });

  it("excludes Artifacts tab when task has no artifacts", () => {
    const task = createMockWorkflowTaskView({ artifacts: {} });
    const tabs = buildTabs(task);
    expect(tabs.some((t) => t.label === "Artifacts")).toBe(false);
  });

  it("always includes Details, Activity, and Logs tabs", () => {
    const task = createMockWorkflowTaskView();
    const tabs = buildTabs(task);
    expect(tabs.some((t) => t.label === "Details")).toBe(true);
    expect(tabs.some((t) => t.label === "Activity")).toBe(true);
    expect(tabs.some((t) => t.label === "Logs")).toBe(true);
  });
});

describe("smartDefaultTab", () => {
  it("returns Artifacts tab for done tasks", () => {
    const task = createMockWorkflowTaskView({
      status: { type: "done" },
      artifacts: { plan: createMockArtifact("plan", "...") },
    });
    const tabs = buildTabs(task);
    const defaultTab = smartDefaultTab(task, tabs);
    expect(defaultTab).toContain("Artifacts");
  });

  it("returns Details tab for failed tasks", () => {
    const task = createMockWorkflowTaskView({
      status: { type: "failed", error: "Something went wrong" },
    });
    const tabs = buildTabs(task);
    const defaultTab = smartDefaultTab(task, tabs);
    expect(defaultTab).toContain("Details");
  });

  it("returns Subtasks tab for waiting_on_children tasks", () => {
    const task = createMockWorkflowTaskView({
      status: { type: "waiting_on_children" },
      derived: {
        subtask_progress: {
          total: 3,
          done: 1,
          failed: 0,
          blocked: 0,
          interrupted: 0,
          has_questions: 0,
          needs_review: 0,
          working: 1,
          waiting: 1,
        },
      },
    });
    const tabs = buildTabs(task);
    const defaultTab = smartDefaultTab(task, tabs);
    expect(defaultTab).toContain("Subtasks");
  });

  it("returns Logs tab for working tasks", () => {
    const task = createMockWorkflowTaskView({
      status: { type: "active", stage: "work" },
      phase: "agent_working",
    });
    const tabs = buildTabs(task);
    const defaultTab = smartDefaultTab(task, tabs);
    expect(defaultTab).toContain("Logs");
  });

  it("falls back to Details if preferred tab not in list", () => {
    const task = createMockWorkflowTaskView({
      status: { type: "done" },
      artifacts: {}, // No artifacts, so Artifacts tab won't exist
    });
    const tabs = buildTabs(task);
    const defaultTab = smartDefaultTab(task, tabs);
    expect(defaultTab).toContain("Details");
  });
});
