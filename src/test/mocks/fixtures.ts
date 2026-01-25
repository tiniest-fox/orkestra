import type {
  WorkflowTask,
  WorkflowConfig,
  WorkflowArtifact,
} from "../../types/workflow";

export function createMockWorkflowTask(
  overrides?: Partial<WorkflowTask>
): WorkflowTask {
  return {
    id: "test-task-123",
    title: "Test Task",
    description: "A test task description",
    status: { type: "active", stage: "planning" },
    phase: "idle",
    artifacts: {},
    pending_questions: [],
    question_history: [],
    depends_on: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
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
          produce_subtasks: false,
          supports_restage: [],
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
          produce_subtasks: true,
          supports_restage: [],
        },
      },
    ],
    integration: { on_failure: "work" },
  };
}

export function createMockArtifact(
  name: string,
  content: string
): WorkflowArtifact {
  return {
    name,
    content,
    stage: "planning",
    created_at: "2025-01-01T00:00:00Z",
    iteration: 1,
  };
}
