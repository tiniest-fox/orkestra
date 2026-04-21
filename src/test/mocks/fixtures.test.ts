// Unit tests for the mock factory system — inference, composition, and backwards compatibility.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMockArtifact,
  createMockFlowConfig,
  createMockIteration,
  createMockStageConfig,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
  resetMockIds,
} from "./fixtures";

beforeEach(() => {
  resetMockIds();
});

describe("state→derived inference", () => {
  it("infers is_failed and is_terminal for failed state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "failed" } });
    expect(task.derived.is_failed).toBe(true);
    expect(task.derived.is_terminal).toBe(true);
    expect(task.derived.current_stage).toBeNull();
  });

  it("infers is_done and is_terminal for done state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "done" } });
    expect(task.derived.is_done).toBe(true);
    expect(task.derived.is_terminal).toBe(true);
    expect(task.derived.current_stage).toBeNull();
  });

  it("infers is_blocked and is_terminal for blocked state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "blocked" } });
    expect(task.derived.is_blocked).toBe(true);
    expect(task.derived.is_terminal).toBe(true);
    expect(task.derived.current_stage).toBeNull();
  });

  it("infers is_working for agent_working state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "agent_working", stage: "work" } });
    expect(task.derived.is_working).toBe(true);
    expect(task.derived.current_stage).toBe("work");
  });

  it("infers needs_review for awaiting_approval state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "review" },
    });
    expect(task.derived.needs_review).toBe(true);
  });

  it("infers has_questions for awaiting_question_answer state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_question_answer", stage: "work" },
    });
    expect(task.derived.has_questions).toBe(true);
    expect(task.derived.needs_review).toBe(true);
  });

  it("infers phase_icon and is_system_active for gate_running state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "gate_running", stage: "work" } });
    expect(task.derived.phase_icon).toBe("gate");
    expect(task.derived.is_system_active).toBe(true);
  });

  it("infers phase_icon for awaiting_gate state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "awaiting_gate", stage: "work" } });
    expect(task.derived.phase_icon).toBe("gate");
    expect(task.derived.is_system_active).toBe(false);
  });

  it("infers is_preparing for queued state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "queued", stage: "planning" } });
    expect(task.derived.is_preparing).toBe(true);
  });

  it("infers is_preparing for setting_up state", () => {
    const task = createMockWorkflowTaskView({ state: { type: "setting_up", stage: "work" } });
    expect(task.derived.is_preparing).toBe(true);
  });

  it("infers pending_approval for awaiting_approval state", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "review" },
    });
    expect(task.derived.pending_approval).toBe(true);
    expect(task.derived.needs_review).toBe(true);
  });
});

describe("override precedence", () => {
  it("explicit derived override wins over auto-inference", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      derived: { is_done: false },
    });
    expect(task.derived.is_done).toBe(false);
  });

  it("accepts iterations and stage_sessions overrides", () => {
    const iteration = createMockIteration({ stage: "planning" });
    const task = createMockWorkflowTaskView({
      iterations: [iteration],
      stage_sessions: [],
    });
    expect(task.iterations).toHaveLength(1);
    expect(task.iterations[0].stage).toBe("planning");
    expect(task.stage_sessions).toHaveLength(0);
  });

  it("defaults to empty arrays when iterations/stage_sessions not provided", () => {
    const task = createMockWorkflowTaskView();
    expect(task.iterations).toEqual([]);
    expect(task.stage_sessions).toEqual([]);
  });
});

describe("composition", () => {
  it("composes custom flow into WorkflowConfig", () => {
    const config = createMockWorkflowConfig({
      flows: {
        custom: createMockFlowConfig({
          stages: [createMockStageConfig({ name: "deploy" })],
        }),
      },
    });
    expect(config.flows.custom).toBeDefined();
    expect(config.flows.custom.stages).toHaveLength(1);
    expect(config.flows.custom.stages[0].name).toBe("deploy");
  });

  it("preserves default flow alongside custom flow", () => {
    const config = createMockWorkflowConfig({
      flows: { custom: createMockFlowConfig() },
    });
    expect(config.flows.default).toBeDefined();
    expect(config.flows.custom).toBeDefined();
  });

  it("createMockFlowConfig accepts stage overrides", () => {
    const flow = createMockFlowConfig({
      stages: [
        createMockStageConfig({
          name: "review",
          gate: true,
          capabilities: {},
        }),
      ],
    });
    expect(flow.stages).toHaveLength(1);
    expect(flow.stages[0].name).toBe("review");
    expect(flow.stages[0].gate).toBe(true);
  });
});

describe("backwards compatibility", () => {
  it("createMockWorkflowConfig with no args produces valid config", () => {
    const config = createMockWorkflowConfig();
    expect(config.version).toBe(2);
    expect(config.flows.default).toBeDefined();
    expect(config.flows.default.stages).toHaveLength(2);
    expect(config.flows.default.stages[0].name).toBe("planning");
    expect(config.flows.default.stages[1].name).toBe("work");
  });

  it("createMockArtifact overrides API works", () => {
    const artifact = createMockArtifact({ name: "summary", stage: "work" });
    expect(artifact.name).toBe("summary");
    expect(artifact.stage).toBe("work");
    expect(artifact.content).toBe("## Plan\nImplementation details here.");
  });

  it("createMockArtifact with no args returns sensible defaults", () => {
    const artifact = createMockArtifact();
    expect(artifact.name).toBe("plan");
    expect(artifact.iteration).toBe(1);
  });
});

describe("unique IDs", () => {
  it("multiple createMockIteration calls produce different IDs", () => {
    const a = createMockIteration();
    const b = createMockIteration();
    const c = createMockIteration();
    expect(a.id).not.toBe(b.id);
    expect(b.id).not.toBe(c.id);
  });

  it("resetMockIds makes IDs deterministic", () => {
    const first = createMockIteration();
    resetMockIds();
    const second = createMockIteration();
    expect(first.id).toBe(second.id);
  });
});
