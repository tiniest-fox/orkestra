//! Tests for the `availableTabs` gate tab visibility logic.

import { describe, expect, it } from "vitest";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../../../test/mocks/fixtures";
import type { WorkflowIteration } from "../../../types/workflow";
import { availableTabs } from "./drawerTabs";

// Config with a gate on the "work" stage.
function configWithGate() {
  const config = createMockWorkflowConfig();
  return {
    ...config,
    stages: config.stages.map((s) =>
      s.name === "work" ? { ...s, gate: { command: "cargo test", timeout_seconds: 60 } } : s,
    ),
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
