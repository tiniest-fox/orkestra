// Composable mock factory infrastructure for workflow types.
import type {
  DerivedTaskState,
  FlowConfig,
  PrStatus,
  SessionLogInfo,
  StageConfig,
  StageLogInfo,
  SubtaskProgress,
  WorkflowArtifact,
  WorkflowConfig,
  WorkflowIteration,
  WorkflowQuestion,
  WorkflowResource,
  WorkflowStageSession,
  WorkflowTask,
  WorkflowTaskView,
} from "../../types/workflow";

// ============================================================================
// Auto-ID Counter
// ============================================================================

let mockIdCounter = 0;

function nextMockId(prefix: string): string {
  return `${prefix}-${++mockIdCounter}`;
}

export function resetMockIds(): void {
  mockIdCounter = 0;
}

// ============================================================================
// Factories
// ============================================================================

export function createMockWorkflowTask(overrides?: Partial<WorkflowTask>): WorkflowTask {
  return {
    id: "test-task-123",
    title: "Test Task",
    description: "A test task description",
    state: { type: "queued", stage: "planning" },
    artifacts: {},
    resources: {},
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
    pending_approval: false,
    stages_with_logs: [],
    subtask_progress: null,
    can_bypass: false,
    ...overrides,
  };
}

export function createMockWorkflowTaskView(
  overrides?: Partial<WorkflowTask> & {
    derived?: Partial<DerivedTaskState>;
    iterations?: WorkflowIteration[];
    stage_sessions?: WorkflowStageSession[];
  },
): WorkflowTaskView {
  const {
    derived: derivedOverrides,
    iterations,
    stage_sessions,
    ...taskOverrides
  } = overrides ?? {};
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
    derivedDefaults.is_terminal = false;
    derivedDefaults.current_stage = null;
  }
  if (state.type === "blocked") {
    derivedDefaults.is_blocked = true;
    derivedDefaults.is_terminal = false;
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
  // Queued state uses "queued" phase_icon and is_preparing
  if (state.type === "queued") {
    derivedDefaults.phase_icon = "queued";
    derivedDefaults.is_preparing = true;
  }
  // Gate states
  if (state.type === "gate_running" || state.type === "awaiting_gate") {
    derivedDefaults.phase_icon = "gate";
    if (state.type === "gate_running") {
      derivedDefaults.is_system_active = true;
    }
  }
  // Setup states also set is_preparing (phase_icon already set above)
  if (state.type === "setting_up" || state.type === "awaiting_setup") {
    derivedDefaults.is_preparing = true;
  }
  // Awaiting approval also sets pending_approval
  if (state.type === "awaiting_approval") {
    derivedDefaults.pending_approval = true;
  }

  return {
    ...task,
    iterations: iterations ?? [],
    stage_sessions: stage_sessions ?? [],
    derived: createMockDerivedState({ ...derivedDefaults, ...derivedOverrides }),
  };
}

export function createMockStageConfig(overrides?: Partial<StageConfig>): StageConfig {
  return {
    name: "work",
    artifact: "summary",
    inputs: [],
    is_optional: false,
    capabilities: {},
    ...overrides,
  };
}

export function createMockFlowConfig(overrides?: Partial<FlowConfig>): FlowConfig {
  return {
    stages: [
      createMockStageConfig({ name: "planning", artifact: "plan" }),
      createMockStageConfig({
        name: "work",
        artifact: "summary",
        inputs: ["plan"],
        capabilities: { subtasks: {} },
      }),
    ],
    integration: { on_failure: "work" },
    ...overrides,
  };
}

export function createMockWorkflowConfig(
  overrides?: Partial<WorkflowConfig> & { flows?: Record<string, Partial<FlowConfig>> },
): WorkflowConfig {
  const defaultFlows = {
    default: createMockFlowConfig(),
  };
  const flows: Record<string, FlowConfig> = {};
  const mergedFlows = { ...defaultFlows, ...overrides?.flows };
  for (const [name, flow] of Object.entries(mergedFlows)) {
    flows[name] = { ...createMockFlowConfig(), ...flow };
  }
  return {
    version: overrides?.version ?? 2,
    flows,
  };
}

export function createMockIteration(overrides?: Partial<WorkflowIteration>): WorkflowIteration {
  return {
    id: nextMockId("mock-iteration"),
    task_id: "test-task-123",
    stage: "work",
    iteration_number: 1,
    started_at: "2026-01-01T10:00:00Z",
    ended_at: "2026-01-01T10:30:00Z",
    ...overrides,
  };
}

export function createMockStageSession(
  overrides?: Partial<WorkflowStageSession>,
): WorkflowStageSession {
  return {
    id: nextMockId("mock-session"),
    task_id: "test-task-123",
    stage: "work",
    spawn_count: 1,
    session_state: "completed",
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-01-01T10:30:00Z",
    ...overrides,
  };
}

export function createMockQuestion(overrides?: Partial<WorkflowQuestion>): WorkflowQuestion {
  return {
    question: "Which implementation approach should we use?",
    options: [
      { label: "Option A", description: "Simpler but less flexible" },
      { label: "Option B", description: "More complex but extensible" },
    ],
    ...overrides,
  };
}

export function createMockSubtaskProgress(overrides?: Partial<SubtaskProgress>): SubtaskProgress {
  return {
    total: 4,
    done: 1,
    failed: 0,
    blocked: 0,
    interrupted: 0,
    has_questions: 0,
    needs_review: 0,
    working: 1,
    waiting: 2,
    ...overrides,
  };
}

export function createMockSessionLogInfo(overrides?: Partial<SessionLogInfo>): SessionLogInfo {
  return {
    session_id: nextMockId("mock-session"),
    run_number: 1,
    is_current: true,
    created_at: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

export function createMockStageLogInfo(overrides?: Partial<StageLogInfo>): StageLogInfo {
  return {
    stage: "work",
    sessions: [createMockSessionLogInfo()],
    ...overrides,
  };
}

export function createMockPrStatus(overrides?: Partial<PrStatus>): PrStatus {
  return {
    url: "https://github.com/org/repo/pull/42",
    state: "open",
    checks: [],
    reviews: [],
    comments: [],
    fetched_at: "2026-01-01T12:00:00Z",
    mergeable: true,
    merge_state_status: null,
    ...overrides,
  };
}

export function createMockResource(overrides?: Partial<WorkflowResource>): WorkflowResource {
  return {
    name: "design-doc",
    url: "https://docs.example.com/design",
    stage: "planning",
    created_at: "2026-01-01T09:00:00Z",
    ...overrides,
  };
}

export function createMockArtifact(overrides?: Partial<WorkflowArtifact>): WorkflowArtifact {
  return {
    name: "plan",
    content: "## Plan\nImplementation details here.",
    stage: "planning",
    created_at: "2026-01-01T00:00:00Z",
    iteration: 1,
    ...overrides,
  };
}
