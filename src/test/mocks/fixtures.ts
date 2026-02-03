import type {
  DerivedTaskState,
  WorkflowArtifact,
  WorkflowConfig,
  WorkflowTask,
  WorkflowTaskView,
} from "../../types/workflow";

export function createMockWorkflowTask(overrides?: Partial<WorkflowTask>): WorkflowTask {
  return {
    id: "test-task-123",
    title: "Test Task",
    description: "A test task description",
    status: { type: "active", stage: "planning" },
    phase: "idle",
    artifacts: {},
    depends_on: [],
    base_branch: "main",
    auto_mode: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

export function createMockDerivedState(overrides?: Partial<DerivedTaskState>): DerivedTaskState {
  return {
    current_stage: "planning",
    is_working: false,
    is_failed: false,
    is_blocked: false,
    is_done: false,
    is_terminal: false,
    is_waiting_on_children: false,
    needs_review: false,
    has_questions: false,
    pending_questions: [],
    rejection_feedback: null,
    stages_with_logs: [],
    subtask_progress: null,
    ...overrides,
  };
}

export function createMockWorkflowTaskView(
  overrides?: Partial<WorkflowTask> & {
    derived?: Partial<DerivedTaskState>;
  },
): WorkflowTaskView {
  const { derived: derivedOverrides, ...taskOverrides } = overrides ?? {};
  const task = createMockWorkflowTask(taskOverrides);

  // Infer derived state from task status/phase when not explicitly overridden
  const status = task.status;
  const derivedDefaults: Partial<DerivedTaskState> = {};
  if (status.type === "active" && "stage" in status) {
    derivedDefaults.current_stage = status.stage;
  }
  if (status.type === "done") {
    derivedDefaults.is_done = true;
    derivedDefaults.is_terminal = true;
    derivedDefaults.current_stage = null;
  }
  if (status.type === "failed") {
    derivedDefaults.is_failed = true;
    derivedDefaults.is_terminal = true;
    derivedDefaults.current_stage = null;
  }
  if (status.type === "blocked") {
    derivedDefaults.is_blocked = true;
    derivedDefaults.is_terminal = true;
    derivedDefaults.current_stage = null;
  }
  if (task.phase === "awaiting_review") {
    derivedDefaults.needs_review = true;
  }
  if (task.phase === "agent_working") {
    derivedDefaults.is_working = true;
  }

  return {
    ...task,
    iterations: [],
    stage_sessions: [],
    derived: createMockDerivedState({ ...derivedDefaults, ...derivedOverrides }),
  };
}

export function createMockWorkflowConfig(): WorkflowConfig {
  return {
    version: 1,
    stages: [
      {
        name: "planning",
        artifact: "plan",
        inputs: [],
        is_automated: true,
        is_optional: false,
        capabilities: {
          ask_questions: true,
        },
      },
      {
        name: "work",
        artifact: "summary",
        inputs: ["plan"],
        is_automated: true,
        is_optional: false,
        capabilities: {
          ask_questions: true,
          subtasks: {},
        },
      },
    ],
    integration: { on_failure: "work" },
    flows: {},
  };
}

export function createMockArtifact(name: string, content: string): WorkflowArtifact {
  return {
    name,
    content,
    stage: "planning",
    created_at: "2025-01-01T00:00:00Z",
    iteration: 1,
  };
}
