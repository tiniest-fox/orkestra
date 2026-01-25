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
 * - failed: Task failed with an error
 * - blocked: Task is blocked waiting for something
 */
export type WorkflowTaskStatus =
  | { type: "active"; stage: string }
  | { type: "waiting_on_children" }
  | { type: "done" }
  | { type: "failed"; error?: string }
  | { type: "blocked"; reason?: string };

/**
 * Task phase - what's happening right now.
 * Uses snake_case to match Rust's serde serialization.
 */
export type WorkflowTaskPhase = "idle" | "agent_working" | "awaiting_review" | "integrating";

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
  | { type: "awaiting_answers"; stage: string }
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
  /** Pending questions awaiting answers. */
  pending_questions: WorkflowQuestion[];
  /** History of answered questions. */
  question_history: WorkflowQuestionAnswer[];
  /** Parent task ID (for subtasks). */
  parent_id?: string;
  /** Task IDs this task depends on. */
  depends_on: string[];
  /** Git branch name. */
  branch_name?: string;
  /** Git worktree path. */
  worktree_path?: string;
  /** PID of running agent (if any). */
  agent_pid?: number;
  /** When the task was created. */
  created_at: string;
  /** When the task was last updated. */
  updated_at: string;
  /** When the task completed (if done). */
  completed_at?: string;
}

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
 * Check if a task needs human review.
 */
export function needsReview(task: WorkflowTask): boolean {
  return task.phase === "awaiting_review" && task.status.type === "active";
}

/**
 * Check if a task has pending questions.
 */
export function hasPendingQuestions(task: WorkflowTask): boolean {
  return (task.pending_questions?.length ?? 0) > 0;
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
