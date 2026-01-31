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
  /** Named flow that subtasks created from this stage should use. */
  subtask_flow?: string;
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
 * Override for a stage within a flow.
 * Only prompt and capabilities can be overridden.
 */
export interface FlowStageOverride {
  /** Override prompt template path. */
  prompt?: string;
  /** Override capabilities (full replace, not merge). */
  capabilities?: StageCapabilities;
}

/**
 * A stage entry in a flow definition.
 * Can be a plain stage name (no overrides) or a stage name with overrides.
 */
export interface FlowStageEntry {
  /** The stage name (must reference a top-level stage). */
  stage_name: string;
  /** Optional overrides for this stage in this flow. */
  overrides?: FlowStageOverride;
}

/**
 * Configuration for an alternate flow (shortened pipeline).
 */
export interface FlowConfig {
  /** Human-readable description of when to use this flow. */
  description: string;
  /** Optional lucide-react icon name (e.g., "zap", "rocket"). */
  icon?: string;
  /** Ordered list of stages in this flow. */
  stages: FlowStageEntry[];
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
  /** Named alternate flows (shortened pipelines). Omitted when empty. */
  flows?: Record<string, FlowConfig>;
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
  /** Pre-rendered HTML from the markdown content. */
  html?: string;
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
  /** Display label for the option. */
  label: string;
  /** Optional description explaining the option. */
  description?: string;
}

/**
 * A question asked by an agent during a stage.
 */
export interface WorkflowQuestion {
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
 * Answers correspond to questions by position (array index).
 */
export interface WorkflowQuestionAnswer {
  /** The original question text (stored for prompt context). */
  question: string;
  /** The answer text (the full label text for predefined options). */
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
 * Note: Questions are stored in iteration outcomes (Outcome::AwaitingAnswers),
 * not on the task itself. Use `task.derived.pending_questions` from WorkflowTaskView.
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
  /** The branch this task was created from (merge/rebase target). */
  base_branch?: string;
  /** Whether the task runs autonomously through all stages. */
  auto_mode: boolean;
  /** Named flow for this task (e.g., "quick_fix"). Null/undefined = default flow. */
  flow?: string;
  /** When the task was created. */
  created_at: string;
  /** When the task was last updated. */
  updated_at: string;
  /** When the task completed (if done). */
  completed_at?: string;
}

// =============================================================================
// Stage Sessions
// =============================================================================

/**
 * State of a stage session.
 */
export type SessionState = "spawning" | "active" | "completed" | "abandoned";

/**
 * A stage session tracking Claude session continuity across iterations.
 */
export interface WorkflowStageSession {
  id: string;
  task_id: string;
  stage: string;
  claude_session_id?: string;
  agent_pid?: number;
  spawn_count: number;
  session_state: SessionState;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Derived Task State
// =============================================================================

/**
 * Pre-computed state derived from task + iterations + sessions.
 * Computed once in the Rust backend — the single source of truth.
 */
export interface DerivedTaskState {
  current_stage: string | null;
  is_working: boolean;
  is_failed: boolean;
  is_blocked: boolean;
  is_done: boolean;
  is_terminal: boolean;
  is_waiting_on_children: boolean;
  needs_review: boolean;
  has_questions: boolean;
  pending_questions: WorkflowQuestion[];
  rejection_feedback: string | null;
  stages_with_logs: string[];
  subtask_progress: SubtaskProgress | null;
}

/**
 * Progress summary for a parent task's subtasks.
 */
export interface SubtaskProgress {
  total: number;
  done: number;
  failed: number;
  in_progress: number;
}

// =============================================================================
// Task View (rich API response)
// =============================================================================

/**
 * A task with pre-joined data and derived state from the backend.
 *
 * Returned by `workflow_get_tasks`. Task fields are flattened to the top level
 * via `#[serde(flatten)]` in Rust, so this extends WorkflowTask with extra fields.
 */
export interface WorkflowTaskView extends WorkflowTask {
  iterations: WorkflowIteration[];
  stage_sessions: WorkflowStageSession[];
  derived: DerivedTaskState;
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
// Branch List
// =============================================================================

/**
 * Available branches returned by workflow_list_branches.
 */
export interface BranchList {
  /** Available branches (excluding task/* branches). */
  branches: string[];
  /** Currently checked-out branch. */
  current: string | null;
  /** Primary branch (main or master). */
  primary: string | null;
}
