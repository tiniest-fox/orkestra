//! Tests for `availableTabs`, `currentArtifact`, and related drawer helpers.

import { describe, expect, it } from "vitest";
import {
  createMockArtifact,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
} from "../../../test/mocks/fixtures";
import type { WorkflowIteration } from "../../../types/workflow";
import { availableTabs, canUseRunScript, currentArtifact, defaultTab } from "./drawerTabs";

describe("defaultTab", () => {
  it("returns 'error' for a failed task", () => {
    const task = createMockWorkflowTaskView({ state: { type: "failed" } });
    expect(defaultTab(task)).toBe("error");
  });

  it("returns 'error' for a blocked task", () => {
    const task = createMockWorkflowTaskView({ state: { type: "blocked", reason: "stuck" } });
    expect(defaultTab(task)).toBe("error");
  });

  it("returns 'logs' for a generic queued task", () => {
    const task = createMockWorkflowTaskView({ state: { type: "queued", stage: "planning" } });
    expect(defaultTab(task)).toBe("logs");
  });

  it("returns 'logs' when task is in chat mode", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { is_chatting: true },
    });
    expect(defaultTab(task)).toBe("logs");
  });

  it("returns 'logs' in chat mode even when needs_review is true", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "review" },
      derived: { is_chatting: true, needs_review: true },
    });
    expect(defaultTab(task)).toBe("logs");
  });
});

describe("availableTabs — blocked task", () => {
  it("returns Error, Logs, Diff, History tabs for a blocked task", () => {
    const config = createMockWorkflowConfig();
    const task = createMockWorkflowTaskView({ state: { type: "blocked", reason: "stuck" } });
    const tabs = availableTabs(task, config);
    expect(tabs.map((t) => t.id)).toEqual(["error", "logs", "diff", "history"]);
  });

  it("blocked tabs match failed tabs in shape", () => {
    const config = createMockWorkflowConfig();
    const blocked = createMockWorkflowTaskView({ state: { type: "blocked", reason: "stuck" } });
    const failed = createMockWorkflowTaskView({ state: { type: "failed" } });
    expect(availableTabs(blocked, config)).toEqual(availableTabs(failed, config));
  });
});

// Config with a gate on the "work" stage.
function configWithGate() {
  const config = createMockWorkflowConfig();
  return {
    ...config,
    flows: {
      ...config.flows,
      default: {
        ...config.flows.default,
        stages: config.flows.default.stages.map((s) =>
          s.name === "work" ? { ...s, gate: { command: "cargo test", timeout_seconds: 60 } } : s,
        ),
      },
    },
  };
}

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

function hasGateTab(tabs: ReturnType<typeof availableTabs>) {
  return tabs.some((t) => t.id === "gate");
}

describe("availableTabs — artifact tab hotkey", () => {
  it("omits hotkey from artifact tab during review state to avoid conflict with Approve", () => {
    const config = createMockWorkflowConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "review" },
      derived: { current_stage: "review", needs_review: true },
    });
    const artifactTab = availableTabs(task, config).find((t) => t.id === "artifact");
    expect(artifactTab).toBeDefined();
    expect(artifactTab?.hotkey).toBeUndefined();
  });

  it("includes hotkey 'a' on artifact tab in non-review state", () => {
    const config = createMockWorkflowConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { current_stage: "work", needs_review: false },
    });
    const artifactTab = availableTabs(task, config).find((t) => t.id === "artifact");
    expect(artifactTab).toBeDefined();
    expect(artifactTab?.hotkey).toBe("a");
  });
});

describe("availableTabs — gate tab visibility", () => {
  it("shows gate tab when task is on gate stage and has a gate result", () => {
    const config = configWithGate();
    const task = {
      ...createMockWorkflowTaskView({
        state: { type: "awaiting_approval", stage: "work" },
        derived: { current_stage: "work", needs_review: true },
      }),
      iterations: [workGateIteration()],
    };
    expect(hasGateTab(availableTabs(task, config))).toBe(true);
  });

  it("hides gate tab when task has advanced past the gate stage", () => {
    // This is the regression case: gate ran on "work", task is now on "review".
    const config = configWithGate();
    const task = {
      ...createMockWorkflowTaskView({
        state: { type: "awaiting_approval", stage: "review" },
        derived: { current_stage: "review", needs_review: true },
      }),
      iterations: [workGateIteration()],
    };
    expect(hasGateTab(availableTabs(task, config))).toBe(false);
  });

  it("shows gate tab when task is in awaiting_gate state", () => {
    const config = configWithGate();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_gate", stage: "work" },
      derived: { current_stage: "work" },
    });
    expect(hasGateTab(availableTabs(task, config))).toBe(true);
  });

  it("shows gate tab when task is in gate_running state", () => {
    const config = configWithGate();
    const task = createMockWorkflowTaskView({
      state: { type: "gate_running", stage: "work" },
      derived: { current_stage: "work" },
    });
    expect(hasGateTab(availableTabs(task, config))).toBe(true);
  });

  it("hides gate tab when task is on gate stage but has no gate result", () => {
    const config = configWithGate();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "work" },
      derived: { current_stage: "work", needs_review: true },
    });
    // iterations defaults to [] — no gate_result
    expect(hasGateTab(availableTabs(task, config))).toBe(false);
  });

  it("hides gate tab when config has no gate stage", () => {
    const config = createMockWorkflowConfig(); // no gate configured
    const task = {
      ...createMockWorkflowTaskView({
        state: { type: "awaiting_approval", stage: "work" },
        derived: { current_stage: "work", needs_review: true },
      }),
      iterations: [workGateIteration()],
    };
    expect(hasGateTab(availableTabs(task, config))).toBe(false);
  });
});

describe("availableTabs — done task tabs", () => {
  it("includes Logs tab when task is done and has no PR", () => {
    const config = createMockWorkflowConfig();
    const task = createMockWorkflowTaskView({ state: { type: "done" } });
    const tabs = availableTabs(task, config);
    expect(tabs.some((t) => t.id === "logs")).toBe(true);
  });

  it("includes Logs tab when task is done and has a PR", () => {
    const config = createMockWorkflowConfig();
    const task = {
      ...createMockWorkflowTaskView({ state: { type: "done" } }),
      pr_url: "https://github.com/org/repo/pull/1",
    };
    const tabs = availableTabs(task, config);
    expect(tabs.some((t) => t.id === "logs")).toBe(true);
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

  it("returns false when task is done", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      worktree_path: "/some/worktree",
    });
    expect(canUseRunScript(task, true)).toBe(false);
  });

  it("returns false when task is archived", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "archived" },
      worktree_path: "/some/worktree",
    });
    expect(canUseRunScript(task, true)).toBe(false);
  });
});

describe("currentArtifact — terminal task fallback", () => {
  it("returns artifact for active task via current_stage", () => {
    const config = createMockWorkflowConfig();
    const artifact = createMockArtifact("summary", "work done");
    const task = {
      ...createMockWorkflowTaskView({
        state: { type: "awaiting_approval", stage: "work" },
        derived: { current_stage: "work", needs_review: true },
        artifacts: { summary: artifact },
      }),
    };
    expect(currentArtifact(task, config)).toEqual(artifact);
  });

  it("returns artifact for done task via last iteration stage", () => {
    const config = createMockWorkflowConfig();
    const artifact = createMockArtifact("summary", "work done");
    const iteration: WorkflowIteration = {
      id: "iter-1",
      task_id: "test-task-123",
      stage: "work",
      iteration_number: 1,
      started_at: "2025-01-01T00:00:00Z",
    };
    const task = {
      ...createMockWorkflowTaskView({
        state: { type: "done" },
        artifacts: { summary: artifact },
      }),
      iterations: [iteration],
    };
    expect(currentArtifact(task, config)).toEqual(artifact);
  });

  it("returns null for done task with no iterations", () => {
    const config = createMockWorkflowConfig();
    const task = createMockWorkflowTaskView({ state: { type: "done" } });
    expect(currentArtifact(task, config)).toBeNull();
  });
});
