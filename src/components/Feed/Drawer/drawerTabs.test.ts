// Tests for `availableTabs`, `defaultTab`, and related drawer helpers.

import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../../../test/mocks/fixtures";
import type { WorkflowIteration } from "../../../types/workflow";
import { availableTabs, canUseRunScript, defaultTab } from "./drawerTabs";

describe("defaultTab", () => {
  it("returns 'error' for a failed task", () => {
    const task = createMockWorkflowTaskView({ state: { type: "failed" } });
    expect(defaultTab(task)).toBe("error");
  });

  it("returns 'error' for a blocked task", () => {
    const task = createMockWorkflowTaskView({ state: { type: "blocked", reason: "stuck" } });
    expect(defaultTab(task)).toBe("error");
  });

  it("returns 'agent' for a generic queued task", () => {
    const task = createMockWorkflowTaskView({ state: { type: "queued", stage: "planning" } });
    expect(defaultTab(task)).toBe("agent");
  });

  it("returns 'agent' when task needs review", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "work" },
      derived: { needs_review: true },
    });
    expect(defaultTab(task)).toBe("agent");
  });

  it("returns 'agent' when task has questions", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "work" },
      derived: { has_questions: true },
    });
    expect(defaultTab(task)).toBe("agent");
  });

  it("returns 'agent' when task is working", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { is_working: true },
    });
    expect(defaultTab(task)).toBe("agent");
  });

  it("returns 'agent' when task is in gate_running state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "gate_running", stage: "work" },
      derived: { current_stage: "work" },
    });
    expect(defaultTab(task)).toBe("agent");
  });

  it("returns 'agent' when task is in awaiting_gate state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_gate", stage: "work" },
      derived: { current_stage: "work" },
    });
    expect(defaultTab(task)).toBe("agent");
  });
});

describe("availableTabs — blocked task", () => {
  it("returns Error, Agent, Diff, History tabs for a blocked task", () => {
    const task = createMockWorkflowTaskView({ state: { type: "blocked", reason: "stuck" } });
    const tabs = availableTabs(task);
    expect(tabs.map((t) => t.id)).toEqual(["error", "agent", "diff", "history"]);
  });

  it("blocked tabs match failed tabs in shape", () => {
    const blocked = createMockWorkflowTaskView({ state: { type: "blocked", reason: "stuck" } });
    const failed = createMockWorkflowTaskView({ state: { type: "failed" } });
    expect(availableTabs(blocked)).toEqual(availableTabs(failed));
  });
});

function workGateIteration(): WorkflowIteration {
  return {
    id: "iter-1",
    task_id: "test-task-123",
    stage: "work",
    iteration_number: 1,
    started_at: "2025-01-01T00:00:00Z",
    gate_result: {
      lines: ["ok"],
      exit_code: 0,
      started_at: "2025-01-01T00:00:00Z",
      ended_at: "2025-01-01T00:00:01Z",
    },
  };
}

describe("availableTabs — agent tab", () => {
  it("includes agent tab with hotkey 'l' during review state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "review" },
      derived: { current_stage: "review", needs_review: true },
    });
    const tab = availableTabs(task).find((t) => t.id === "agent");
    expect(tab).toBeDefined();
    expect(tab?.hotkey).toBe("l");
  });

  it("includes agent tab in working state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { current_stage: "work", needs_review: false },
    });
    const tab = availableTabs(task).find((t) => t.id === "agent");
    expect(tab).toBeDefined();
    expect(tab?.hotkey).toBe("l");
  });

  it("does not include artifact or logs or questions tabs", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { current_stage: "work" },
    });
    const tabIds = availableTabs(task).map((t) => t.id);
    expect(tabIds).not.toContain("artifact");
    expect(tabIds).not.toContain("logs");
    expect(tabIds).not.toContain("questions");
  });
});

describe("availableTabs — no gate tab", () => {
  it("never includes gate tab even with gate results on the iteration", () => {
    const task = {
      ...createMockWorkflowTaskView({
        state: { type: "gate_running", stage: "work" },
        derived: { current_stage: "work" },
      }),
      iterations: [workGateIteration()],
    };
    const tabs = availableTabs(task);
    expect(tabs.some((t) => t.id === "gate")).toBe(false);
  });

  it("never includes gate tab in awaiting_gate state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_gate", stage: "work" },
      derived: { current_stage: "work" },
    });
    expect(availableTabs(task).some((t) => t.id === "gate")).toBe(false);
  });
});

describe("availableTabs — done task tabs", () => {
  it("includes Agent tab when task is done and has no PR", () => {
    const task = createMockWorkflowTaskView({ state: { type: "done" } });
    const tabs = availableTabs(task);
    expect(tabs.some((t) => t.id === "agent")).toBe(true);
  });

  it("includes Agent tab when task is done and has a PR", () => {
    const task = {
      ...createMockWorkflowTaskView({ state: { type: "done" } }),
      pr_url: "https://github.com/org/repo/pull/1",
    };
    const tabs = availableTabs(task);
    expect(tabs.some((t) => t.id === "agent")).toBe(true);
  });
});

describe("canUseRunScript", () => {
  it("returns true when all conditions are met", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      worktree_path: "/some/worktree",
    });
    expect(canUseRunScript(task, true)).toBe(true);
  });

  it("returns false when hasRunScript is false", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      worktree_path: "/some/worktree",
    });
    expect(canUseRunScript(task, false)).toBe(false);
  });

  it("returns false when hasRunScript is undefined", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      worktree_path: "/some/worktree",
    });
    expect(canUseRunScript(task, undefined)).toBe(false);
  });

  it("returns false when worktree_path is missing", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
    });
    expect(canUseRunScript(task, true)).toBe(false);
  });

  it("returns true when task is done (worktree still exists)", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      worktree_path: "/some/worktree",
    });
    expect(canUseRunScript(task, true)).toBe(true);
  });

  it("returns false when task is archived", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "archived" },
      worktree_path: "/some/worktree",
    });
    expect(canUseRunScript(task, true)).toBe(false);
  });
});

describe("availableTabs — resources tab visibility", () => {
  it("includes Resources tab when task has resources", () => {
    const task = {
      ...createMockWorkflowTaskView({ state: { type: "agent_working", stage: "work" } }),
      resources: {
        "my-doc": {
          name: "my-doc",
          url: "https://example.com/doc",
          stage: "work",
          created_at: "2025-01-01T00:00:00Z",
        },
      },
    };
    const tabs = availableTabs(task);
    expect(tabs.some((t) => t.id === "resources")).toBe(true);
  });

  it("omits Resources tab when task has no resources", () => {
    const task = createMockWorkflowTaskView({ state: { type: "agent_working", stage: "work" } });
    const tabs = availableTabs(task);
    expect(tabs.some((t) => t.id === "resources")).toBe(false);
  });

  it("includes Resources tab for done task with resources", () => {
    const task = {
      ...createMockWorkflowTaskView({ state: { type: "done" } }),
      resources: {
        ref: {
          name: "ref",
          url: "https://github.com/org/repo",
          stage: "planning",
          created_at: "2025-01-01T00:00:00Z",
        },
      },
    };
    const tabs = availableTabs(task);
    expect(tabs.some((t) => t.id === "resources")).toBe(true);
  });

  it("Resources tab has no hotkey", () => {
    const task = {
      ...createMockWorkflowTaskView({ state: { type: "agent_working", stage: "work" } }),
      resources: {
        ref: {
          name: "ref",
          url: "https://example.com",
          stage: "work",
          created_at: "2025-01-01T00:00:00Z",
        },
      },
    };
    const resourcesTab = availableTabs(task).find((t) => t.id === "resources");
    expect(resourcesTab).toBeDefined();
    expect(resourcesTab?.hotkey).toBeUndefined();
  });
});
