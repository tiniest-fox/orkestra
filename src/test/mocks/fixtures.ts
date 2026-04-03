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
    state: { type: "queued", stage: "planning" },
    artifacts: {},
    depends_on: [],
    base_branch: "main",
    base_commit: "",
    auto_mode: false,
    flow: "default",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

export function createMockDerivedState(overrides?: Partial<DerivedTaskState>): DerivedTaskState {
  return {
    current_stage: "planning",
    is_working: false,
    is_system_active: false,
    is_preparing: false,
    phase_icon: null,
    is_interrupted: false,
    is_failed: false,
    is_blocked: false,
    is_done: false,
    is_archived: false,
    is_terminal: false,
    is_waiting_on_children: false,
    needs_review: false,
    has_questions: false,
    pending_questions: [],
    rejection_feedback: null,
    pending_rejection: null,
    stages_with_logs: [],
    subtask_progress: null,
    is_chatting: false,
    chat_agent_active: false,
    is_interactive: false,
    can_bypass: false,
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

  // Infer derived state from task state when not explicitly overridden
  const { state } = task;
  const derivedDefaults: Partial<DerivedTaskState> = {};

  // Extract stage from state (most variants carry a stage)
  if ("stage" in state) {
    derivedDefaults.current_stage = state.stage;
  }

  // Terminal states
  if (state.type === "done") {
    derivedDefaults.is_done = true;
    derivedDefaults.is_terminal = true;
    derivedDefaults.current_stage = null;
  }
  if (state.type === "archived") {
    derivedDefaults.is_archived = true;
    derivedDefaults.is_terminal = true;
    derivedDefaults.current_stage = null;
  }
  if (state.type === "failed") {
    derivedDefaults.is_failed = true;
    derivedDefaults.is_terminal = true;
    derivedDefaults.current_stage = null;
  }
  if (state.type === "blocked") {
    derivedDefaults.is_blocked = true;
    derivedDefaults.is_terminal = true;
    derivedDefaults.current_stage = null;
  }

  // Active states
  if (
    state.type === "awaiting_approval" ||
    state.type === "awaiting_question_answer" ||
    state.type === "awaiting_rejection_confirmation"
  ) {
    derivedDefaults.needs_review = true;
  }
  if (state.type === "awaiting_question_answer") {
    derivedDefaults.has_questions = true;
  }
  if (state.type === "agent_working") {
    derivedDefaults.is_working = true;
  }
  if (state.type === "interrupted") {
    derivedDefaults.is_interrupted = true;
  }
  if (state.type === "waiting_on_children") {
    derivedDefaults.is_waiting_on_children = true;
  }
  // Git-related states use simplified "git" phase_icon
  if (
    state.type === "committing" ||
    state.type === "integrating" ||
    state.type === "setting_up" ||
    state.type === "awaiting_setup"
  ) {
    derivedDefaults.phase_icon = "git";
    if (state.type === "committing" || state.type === "integrating") {
      derivedDefaults.is_system_active = true;
    }
  }
  // System busy states (finishing, committed) also use "git" since they're part of integration
  if (state.type === "finishing" || state.type === "committed") {
    derivedDefaults.phase_icon = "git";
    derivedDefaults.is_system_active = true;
  }
  // Queued state uses "queued" phase_icon
  if (state.type === "queued") {
    derivedDefaults.phase_icon = "queued";
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
    version: 2,
    flows: {
      default: {
        description: "Default pipeline",
        stages: [
          {
            name: "planning",
            artifact: "plan",
            inputs: [],
            is_automated: true,
            is_optional: false,
            capabilities: { ask_questions: true },
          },
          {
            name: "work",
            artifact: "summary",
            inputs: ["plan"],
            is_automated: true,
            is_optional: false,
            capabilities: { ask_questions: true, subtasks: {} },
          },
        ],
        integration: { on_failure: "work" },
      },
    },
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
