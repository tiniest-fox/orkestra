/**
 * Types for the new stage-agnostic workflow system.
 * These types match the Rust domain types in orkestra-core/src/workflow/.
 */

// =============================================================================
// Workflow Configuration (from workflow.yaml)
// =============================================================================

/**
 * Stage capabilities - what actions a stage can perform.
 */
export interface StageCapabilities {
  /** Whether the stage can ask clarifying questions. */
  ask_questions: boolean;
  /** Whether the stage can produce subtasks. */
  produce_subtasks: boolean;
  /** Which stages this stage can restage to (e.g., review can restage to work). */
  supports_restage: string[];
}

/**
 * Configuration for a single workflow stage.
 */
export interface StageConfig {
  /** Unique name of the stage (e.g., "planning", "work", "review"). */
  name: string;
  /** Optional display name for the UI (defaults to capitalized name). */
  display_name?: string;
  /** Name of the artifact this stage produces (e.g., "plan", "summary"). */
  artifact: string;
  /** Artifacts required as inputs from previous stages. */
  inputs: string[];
  /** Whether this stage is automated (no human review required). */
  is_automated: boolean;
  /** Whether this stage is optional (can be skipped). */
  is_optional: boolean;
  /** Stage capabilities. */
  capabilities: StageCapabilities;
}

/**
 * Integration configuration for merging completed tasks.
 */
export interface IntegrationConfig {
  /** Stage to return to on integration failure (default: "work"). */
  on_failure: string;
}

/**
 * Complete workflow configuration loaded from workflow.yaml.
 */
export interface WorkflowConfig {
  /** Config file version. */
  version: number;
  /** Ordered list of stages in the workflow. */
  stages: StageConfig[];
  /** Integration settings. */
  integration: IntegrationConfig;
}

// =============================================================================
// Task Status and Phase
// =============================================================================

/**
 * Task status - where the task is in the workflow.
 * Uses snake_case for type field to match Rust's serde serialization.
 *
 * - active: Task is in a specific stage
 * - waiting_on_children: Task is waiting for subtasks to complete
 * - done: Task completed successfully
 * - archived: Task completed and integrated (branch merged)
 * - failed: Task failed with an error
 * - blocked: Task is blocked waiting for something
 */
export type WorkflowTaskStatus =
  | { type: "active"; stage: string }
  | { type: "waiting_on_children" }
  | { type: "done" }
  | { type: "archived" }
  | { type: "failed"; error?: string }
  | { type: "blocked"; reason?: string };

/**
 * Task phase - what's happening right now.
 * Uses snake_case to match Rust's serde serialization.
 */
export type WorkflowTaskPhase =
  | "setting_up"
  | "idle"
  | "agent_working"
  | "awaiting_review"
  | "integrating";

// =============================================================================
// Artifacts
// =============================================================================

/**
 * An artifact produced by a stage (e.g., plan, summary, verdict).
 */
export interface WorkflowArtifact {
  /** Name of the artifact (matches stage.artifact in config). */
  name: string;
  /** Content of the artifact (usually markdown). */
  content: string;
  /** Stage that produced this artifact. */
  stage: string;
  /** When the artifact was created. */
  created_at: string;
  /** Iteration number that produced this artifact (0-indexed). */
  iteration: number;
}

// =============================================================================
// Questions
// =============================================================================

/**
 * An option for a multiple-choice question.
 */
export interface WorkflowQuestionOption {
  /** Unique ID for this option. */
  id: string;
  /** Display label for the option. */
  label: string;
  /** Optional description explaining the option. */
  description?: string;
}

/**
 * A question asked by an agent during a stage.
 */
export interface WorkflowQuestion {
  /** Unique ID for this question. */
  id: string;
  /** The question text. */
  question: string;
  /** Optional context explaining why the question is asked. */
  context?: string;
  /** Available options (if multiple choice). Omitted for free-form questions. */
  options?: WorkflowQuestionOption[];
}

/**
 * An answer to a question.
 * Matches Rust's QuestionAnswer struct.
 */
export interface WorkflowQuestionAnswer {
  /** ID of the question being answered. */
  question_id: string;
  /** The original question text (stored for prompt context). */
  question: string;
  /** The answer text (or option ID for multiple choice). */
  answer: string;
  /** When the answer was provided (RFC3339). */
  answered_at: string;
}

// =============================================================================
// Iterations
// =============================================================================

/**
 * Outcome of an iteration (how it ended).
 * Uses snake_case to match Rust's serde serialization.
 */
export type WorkflowOutcome =
  | { type: "approved" }
  | { type: "rejected"; stage: string; feedback: string }
  | { type: "awaiting_answers"; stage: string; questions: WorkflowQuestion[] }
  | { type: "completed"; merged_at?: string; commit_sha?: string; target_branch?: string }
  | { type: "integration_failed"; error: string; conflict_files: string[] }
  | { type: "agent_error"; error: string }
  | { type: "blocked"; reason: string }
  | { type: "skipped"; stage: string; reason: string }
  | { type: "restage"; from_stage: string; target: string; feedback: string };

/**
 * A single iteration within a stage (one agent run).
 */
export interface WorkflowIteration {
  /** Unique ID for this iteration. */
  id: string;
  /** Task this iteration belongs to. */
  task_id: string;
  /** Stage this iteration is in. */
  stage: string;
  /** Iteration number within the stage (1-based). */
  iteration_number: number;
  /** When the iteration started. */
  started_at: string;
  /** When the iteration ended (null if still running). */
  ended_at?: string;
  /** How the iteration ended (null if still running). */
  outcome?: WorkflowOutcome;
  /** Claude session ID for logs. */
  session_id?: string;
}

// =============================================================================
// Task
// =============================================================================

/**
 * A workflow task.
 *
 * Note: Questions are now stored in iteration outcomes (Outcome::AwaitingAnswers),
 * not on the task itself. Use the workflow_get_pending_questions API to fetch them.
 */
export interface WorkflowTask {
  /** Unique task ID (e.g., "gentle-fuzzy-otter"). */
  id: string;
  /** Task title. */
  title: string;
  /** Task description. */
  description: string;
  /** Current status (which stage, or terminal state). */
  status: WorkflowTaskStatus;
  /** Current phase (what's happening now). */
  phase: WorkflowTaskPhase;
  /** Artifacts produced so far, keyed by artifact name. */
  artifacts: Record<string, WorkflowArtifact>;
  /** Parent task ID (for subtasks). */
  parent_id?: string;
  /** Task IDs this task depends on. */
  depends_on: string[];
  /** Git branch name. */
  branch_name?: string;
  /** Git worktree path. */
  worktree_path?: string;
  /** When the task was created. */
  created_at: string;
  /** When the task was last updated. */
  updated_at: string;
  /** When the task completed (if done). */
  completed_at?: string;
}

// =============================================================================
// Session Log Types
// =============================================================================

/**
 * A single todo item from `TodoWrite` tool.
 */
export interface TodoItem {
  content: string;
  status: string; // "pending", "in_progress", "completed"
  activeForm: string;
}

/**
 * Ork CLI action types for specialized display.
 * Uses snake_case action field to match Rust's serde serialization.
 */
export type OrkAction =
  | { action: "set_plan"; task_id: string }
  | { action: "complete"; task_id: string; summary?: string }
  | { action: "fail"; task_id: string; reason?: string }
  | { action: "block"; task_id: string; reason?: string }
  | { action: "approve"; task_id: string }
  | { action: "approve_review"; task_id: string }
  | { action: "reject_review"; task_id: string; feedback?: string }
  | { action: "create_subtask"; parent_id: string; title: string }
  | { action: "set_breakdown"; task_id: string }
  | { action: "approve_breakdown"; task_id: string }
  | { action: "skip_breakdown"; task_id: string }
  | { action: "complete_subtask"; subtask_id: string }
  | { action: "other"; raw: string };

/**
 * Tool input details for structured logging.
 * Uses snake_case tool field to match Rust's serde serialization.
 */
export type ToolInput =
  | { tool: "bash"; command: string }
  | { tool: "read"; file_path: string }
  | { tool: "write"; file_path: string }
  | { tool: "edit"; file_path: string }
  | { tool: "glob"; pattern: string }
  | { tool: "grep"; pattern: string }
  | { tool: "task"; description: string }
  | { tool: "todo_write"; todos: TodoItem[] }
  | { tool: "ork"; ork_action: OrkAction }
  | { tool: "structured_output"; output_type: string }
  | { tool: "other"; summary: string };

/**
 * Resume type for session resumption markers.
 * - "continue": Agent was interrupted, continue from where left off
 * - "feedback": Human provided feedback to address
 * - "integration": Integration failed with merge conflict
 * - "answers": Human provided answers to questions
 */
export type ResumeType = "continue" | "feedback" | "integration" | "answers";

/**
 * Structured log entry for task execution (loaded from Claude's session files).
 * Uses snake_case type field to match Rust's serde serialization.
 */
export type LogEntry =
  | { type: "text"; content: string }
  | {
      type: "user_message";
      /** Type of resume: "continue", "feedback", or "integration". Defaults to "continue". */
      resume_type?: ResumeType;
      content: string;
    }
  | { type: "tool_use"; tool: string; id: string; input: ToolInput }
  | { type: "tool_result"; tool: string; tool_use_id: string; content: string }
  | {
      type: "subagent_tool_use";
      tool: string;
      id: string;
      input: ToolInput;
      parent_task_id: string;
    }
  | {
      type: "subagent_tool_result";
      tool: string;
      tool_use_id: string;
      content: string;
      parent_task_id: string;
    }
  | { type: "process_exit"; code?: number }
  | { type: "error"; message: string }
  // Script stage log entries
  | { type: "script_start"; command: string; stage: string }
  | { type: "script_output"; content: string }
  | { type: "script_exit"; code: number; success: boolean; timed_out: boolean };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the current stage name from a task status.
 * Returns undefined for terminal states (done, failed, blocked, waiting_on_children).
 */
export function getTaskStage(status: WorkflowTaskStatus): string | undefined {
  return status.type === "active" ? status.stage : undefined;
}

/**
 * Check if a task is in a terminal state.
 */
export function isTaskTerminal(status: WorkflowTaskStatus): boolean {
  return status.type !== "active" && status.type !== "waiting_on_children";
}

/**
 * Check if a task is archived (completed and integrated).
 */
export function isTaskArchived(status: WorkflowTaskStatus): boolean {
  return status.type === "archived";
}

/**
 * Check if a task needs human review.
 */
export function needsReview(task: WorkflowTask): boolean {
  return task.phase === "awaiting_review" && task.status.type === "active";
}

/**
 * Check if a task might have pending questions based on phase.
 *
 * Note: This is a heuristic check. To get actual pending questions,
 * use the workflow_get_pending_questions Tauri command.
 *
 * @deprecated Use workflow_get_pending_questions API instead
 */
export function hasPendingQuestions(task: WorkflowTask): boolean {
  // A task in awaiting_review phase with active status might have questions
  // The actual questions must be fetched via API
  return task.phase === "awaiting_review" && task.status.type === "active";
}

/**
 * Get the artifact content for a specific artifact name.
 */
export function getArtifactContent(task: WorkflowTask, name: string): string | undefined {
  return task.artifacts?.[name]?.content;
}

/**
 * Capitalize the first letter of a string.
 */
export function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
