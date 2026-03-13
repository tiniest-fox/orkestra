import { describe, expect, it } from "vitest";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../test/mocks/fixtures";
import type { WorkflowConfig } from "../types/workflow";
import { applyOptimisticTransition } from "./optimisticTransitions";

function createConfig(): WorkflowConfig {
  const base = createMockWorkflowConfig();
  return {
    ...base,
    stages: [
      ...base.stages,
      {
        name: "review",
        artifact: "verdict",
        inputs: ["summary"],
        is_automated: false,
        is_optional: false,
        capabilities: { ask_questions: false, approval: {} },
      },
    ],
    flows: {
      quick: {
        description: "Skip planning",
        stages: ["work", "review"],
      },
    },
  };
}

// Sentinel subtask_progress to verify untouched derived fields are preserved.
const SENTINEL_SUBTASK_PROGRESS = {
  total: 5,
  done: 2,
  failed: 0,
  blocked: 0,
  interrupted: 0,
  has_questions: 0,
  needs_review: 0,
  working: 1,
  waiting: 2,
};
const SENTINEL_STAGES_WITH_LOGS = [{ stage: "planning", sessions: [] }];

describe("applyOptimisticTransition — approve", () => {
  it("advances to next stage when approving from awaiting_approval on a middle stage", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "work" },
      derived: {
        subtask_progress: SENTINEL_SUBTASK_PROGRESS,
        stages_with_logs: SENTINEL_STAGES_WITH_LOGS,
      },
    });

    const result = applyOptimisticTransition(task, { type: "approve" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "queued", stage: "review" });
    expect(result?.derived.current_stage).toBe("review");
    expect(result?.derived.needs_review).toBe(false);
    expect(result?.derived.has_questions).toBe(false);
    expect(result?.derived.is_working).toBe(false);
    expect(result?.derived.phase_icon).toBe("queued");
  });

  it("transitions to done when approving the last stage", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "review" },
    });

    const result = applyOptimisticTransition(task, { type: "approve" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "done" });
    expect(result?.derived.current_stage).toBeNull();
    expect(result?.derived.needs_review).toBe(false);
    expect(result?.derived.is_done).toBe(true);
    expect(result?.derived.is_terminal).toBe(true);
    expect(result?.derived.phase_icon).toBeNull();
  });

  it("respects flow stage ordering when approving", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      flow: "quick",
      state: { type: "awaiting_approval", stage: "work" },
    });

    const result = applyOptimisticTransition(task, { type: "approve" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "queued", stage: "review" });
  });

  it("uses pending_rejection.target when approving from awaiting_rejection_confirmation", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_rejection_confirmation", stage: "review" },
      derived: {
        pending_rejection: { from_stage: "review", target: "work", feedback: "needs more work" },
      },
    });

    const result = applyOptimisticTransition(task, { type: "approve" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "agent_working", stage: "work" });
    expect(result?.derived.current_stage).toBe("work");
    expect(result?.derived.is_working).toBe(true);
    expect(result?.derived.pending_rejection).toBeNull();
  });

  it("returns null when approving from awaiting_rejection_confirmation with no pending_rejection", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_rejection_confirmation", stage: "review" },
      derived: { pending_rejection: null },
    });

    expect(applyOptimisticTransition(task, { type: "approve" }, config)).toBeNull();
  });

  it("returns null when approving from an invalid state", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
    });

    expect(applyOptimisticTransition(task, { type: "approve" }, config)).toBeNull();
  });

  it("preserves untouched derived fields (subtask_progress, stages_with_logs)", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "work" },
      derived: {
        subtask_progress: SENTINEL_SUBTASK_PROGRESS,
        stages_with_logs: SENTINEL_STAGES_WITH_LOGS,
      },
    });

    const result = applyOptimisticTransition(task, { type: "approve" }, config);

    expect(result?.derived.subtask_progress).toBe(SENTINEL_SUBTASK_PROGRESS);
    expect(result?.derived.stages_with_logs).toBe(SENTINEL_STAGES_WITH_LOGS);
  });
});

describe("applyOptimisticTransition — reject", () => {
  it("sends back to agent_working at same stage", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "review" },
    });

    const result = applyOptimisticTransition(task, { type: "reject", feedback: "bad" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "agent_working", stage: "review" });
    expect(result?.derived.needs_review).toBe(false);
    expect(result?.derived.is_working).toBe(true);
    expect(result?.derived.pending_rejection).toBeNull();
  });

  it("works from awaiting_rejection_confirmation", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_rejection_confirmation", stage: "review" },
      derived: {
        pending_rejection: { from_stage: "review", target: "work", feedback: "fix it" },
      },
    });

    const result = applyOptimisticTransition(task, { type: "reject", feedback: "bad" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "agent_working", stage: "review" });
  });

  it("returns null when rejecting from an invalid state", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
    });

    expect(applyOptimisticTransition(task, { type: "reject", feedback: "bad" }, config)).toBeNull();
  });
});

describe("applyOptimisticTransition — answer_questions", () => {
  it("sends back to agent_working at same stage", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_question_answer", stage: "planning" },
      derived: { pending_questions: [{ question: "What?" }] },
    });

    const result = applyOptimisticTransition(task, { type: "answer_questions" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "agent_working", stage: "planning" });
    expect(result?.derived.has_questions).toBe(false);
    expect(result?.derived.pending_questions).toEqual([]);
    expect(result?.derived.needs_review).toBe(false);
    expect(result?.derived.is_working).toBe(true);
  });

  it("returns null when not awaiting questions", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "awaiting_approval", stage: "work" },
    });

    expect(applyOptimisticTransition(task, { type: "answer_questions" }, config)).toBeNull();
  });
});

describe("applyOptimisticTransition — interrupt", () => {
  it("transitions agent_working to interrupted", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
    });

    const result = applyOptimisticTransition(task, { type: "interrupt" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "interrupted", stage: "work" });
    expect(result?.derived.is_working).toBe(false);
    expect(result?.derived.is_interrupted).toBe(true);
    expect(result?.derived.phase_icon).toBeNull();
  });

  it("transitions queued to interrupted", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "queued", stage: "work" },
    });

    const result = applyOptimisticTransition(task, { type: "interrupt" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "interrupted", stage: "work" });
  });

  it("returns null when not interruptable", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
    });

    expect(applyOptimisticTransition(task, { type: "interrupt" }, config)).toBeNull();
  });
});

describe("applyOptimisticTransition — resume", () => {
  it("transitions interrupted to queued at same stage", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "interrupted", stage: "work" },
    });

    const result = applyOptimisticTransition(task, { type: "resume" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "queued", stage: "work" });
    expect(result?.derived.is_interrupted).toBe(false);
    expect(result?.derived.phase_icon).toBe("queued");
  });

  it("returns null when not interrupted", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
    });

    expect(applyOptimisticTransition(task, { type: "resume" }, config)).toBeNull();
  });
});

describe("applyOptimisticTransition — archive", () => {
  it("transitions done to archived", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
    });

    const result = applyOptimisticTransition(task, { type: "archive" }, config);

    expect(result).not.toBeNull();
    expect(result?.state).toEqual({ type: "archived" });
    expect(result?.derived.is_archived).toBe(true);
    expect(result?.derived.is_terminal).toBe(true);
    expect(result?.derived.current_stage).toBeNull();
    expect(result?.derived.is_done).toBe(false);
    expect(result?.derived.phase_icon).toBeNull();
  });

  it("returns null when not done", () => {
    const config = createConfig();
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
    });

    expect(applyOptimisticTransition(task, { type: "archive" }, config)).toBeNull();
  });
});
