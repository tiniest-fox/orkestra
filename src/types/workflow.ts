/**
 * Types for the new stage-agnostic workflow system.
 * Based on the Rust domain types in orkestra-core/src/workflow/.
 * Note: These types are a subset - not all Rust fields are represented here.
 * Only includes fields currently consumed by the frontend.
 */

// =============================================================================
// Workflow Configuration (from workflow.yaml)
// =============================================================================

/**
 * Stage capabilities - what actions a stage can perform.
 */
export interface StageCapabilities {
  /** Subtask capabilities. Presence indicates the stage can produce subtasks. */
  subtasks?: SubtaskCapabilities;
}

/**
 * Configuration for a stage that produces subtasks.
 */
export interface SubtaskCapabilities {
  /** Named flow that subtasks should use. */
  flow?: string;
}

/**
 * Artifact config — either a plain name string or a rich object with just the name.
 * Mirrors ArtifactConfig's custom serde in Rust.
 */
export type ArtifactConfig = string | { name: string };

/** Extract the artifact name string from an ArtifactConfig. */
export function artifactName(artifact: ArtifactConfig): string {
  return typeof artifact === "string" ? artifact : artifact.name;
}

/**
 * Gate configuration for a workflow stage.
 * - `true` — agentic gate (agent produces approve/reject decision)
 * - `{ command, timeout_seconds }` — automated script gate
 */
export type GateConfig =
  | true
  | {
      /** Shell command to run as the gate. */
      command: string;
      /** Timeout in seconds for the gate process. */
      timeout_seconds: number;
    };

/**
 * Configuration for a single workflow stage.
 */
export interface StageConfig {
  /** Unique name of the stage (e.g., "planning", "work", "review"). */
  name: string;
  /** Artifact config for the output this stage produces. */
  artifact: ArtifactConfig;
  /** Artifacts required as inputs from previous stages. */
  inputs: string[];
  /** Whether this stage is optional (can be skipped). */
  is_optional: boolean;
  /** Stage capabilities. */
  capabilities: StageCapabilities;
  /** Gate config — runs after agent completes, before advancing. `true` = agentic gate. */
  gate?: GateConfig | null;
}

/**
 * Integration configuration for merging completed tasks.
 */
export interface IntegrationConfig {
  /** Stage to return to on integration failure (default: "work"). */
  on_failure: string;
}

/**
 * Configuration for an alternate flow (complete pipeline).
 */
export interface FlowConfig {
  /** Ordered list of stages in this flow (full StageConfig objects). */
  stages: StageConfig[];
  /** Integration settings for this flow. */
  integration: IntegrationConfig;
}

/**
 * Complete workflow configuration loaded from workflow.yaml.
 * All pipelines are named flows — there is no separate global stage list.
 */
export interface WorkflowConfig {
  /** Config file version. */
  version: number;
  /** Named flows (complete pipelines). Always has at least one entry. */
  flows: Record<string, FlowConfig>;
}

// =============================================================================
// Task State
// =============================================================================

/**
 * Unified task state - replaces the old Status + Phase split.
 * Each variant has exactly one meaning. Uses snake_case type field
 * to match Rust's `#[serde(tag = "type", rename_all = "snake_case")]`.
 */
export type TaskState =
  | { type: "awaiting_setup"; stage: string }
  | { type: "setting_up"; stage: string }
  | { type: "queued"; stage: string }
  | { type: "agent_working"; stage: string }
  | { type: "awaiting_gate"; stage: string }
  | { type: "gate_running"; stage: string }
  | { type: "finishing"; stage: string }
  | { type: "committing"; stage: string }
  | { type: "committed"; stage: string }
  | { type: "integrating" }
  | { type: "awaiting_approval"; stage: string }
  | { type: "awaiting_question_answer"; stage: string }
  | { type: "awaiting_rejection_confirmation"; stage: string }
  | { type: "interrupted"; stage: string }
  | { type: "waiting_on_children"; stage: string }
  | { type: "interactive"; stage: string }
  | { type: "done" }
  | { type: "archived" }
  | { type: "failed"; error?: string }
  | { type: "blocked"; reason?: string };

// =============================================================================
// Resources
// =============================================================================

/**
 * An external resource registered by an agent during stage execution.
 */
export interface WorkflowResource {
  /** Resource name (unique key). */
  name: string;
  /** URL or file path for the resource. */
  url: string;
  /** Optional description of what the resource is. */
  description?: string;
  /** Stage that registered this resource. */
  stage: string;
  /** When the resource was registered (RFC3339). */
  created_at: string;
}

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
  /** Iteration number that produced this artifact (1-based). */
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
  | { type: "spawn_failed"; error: string }
  | { type: "blocked"; reason: string }
  | { type: "skipped"; stage: string; reason: string }
  | { type: "rejection"; from_stage: string; target: string; feedback: string }
  | { type: "awaiting_rejection_review"; from_stage: string; target: string; feedback: string }
  | { type: "gate_failed"; stage: string; error: string }
  | { type: "commit_failed"; error: string }
  | { type: "interrupted" };

/**
 * PR comment data stored in iteration trigger.
 * Captured at action time and used for prompt building.
 */
export interface PrCommentData {
  author: string;
  body: string;
  path: string | null;
  line: number | null;
}

/**
 * Failed CI check data stored in iteration trigger.
 * Captured at action time and used for prompt building.
 */
export interface PrCheckData {
  name: string;
  log_excerpt: string | null;
}

/**
 * Why an iteration was created - determines the resume prompt type.
 * Uses snake_case to match Rust's serde serialization.
 */
export type IterationTrigger =
  | { type: "feedback"; feedback: string }
  | { type: "rejection"; from_stage: string; feedback: string }
  | { type: "integration"; message: string; conflict_files: string[] }
  | { type: "answers"; answers: WorkflowQuestionAnswer[] }
  | { type: "interrupted" }
  | { type: "gate_failure"; error: string }
  | { type: "retry_failed"; instructions?: string }
  | { type: "retry_blocked"; instructions?: string }
  | { type: "manual_resume"; message?: string }
  | { type: "return_from_interactive" }
  | {
      type: "pr_feedback";
      comments: PrCommentData[];
      checks: PrCheckData[];
      guidance?: string;
    }
  /** Old DB records may use pr_comments as the type — treated the same as pr_feedback. */
  | { type: "pr_comments"; comments: PrCommentData[]; checks?: PrCheckData[]; guidance?: string };

/**
 * Output from a gate script run, stored on the iteration being validated.
 * Updated incrementally while gate is running; complete when exit_code is set.
 */
export interface GateResult {
  /** All output lines accumulated during the gate run. */
  lines: string[];
  /** Exit code — null while gate is running, set on completion. */
  exit_code: number | null;
  /** When the gate started (RFC3339). */
  started_at: string;
  /** When the gate ended (RFC3339) — null while running. */
  ended_at: string | null;
}

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
  /** Short narrative summary of what the agent did during this iteration. */
  activity_log?: string;
  /** Context explaining why this iteration was created (e.g., user message, feedback, rejection). */
  incoming_context?: IterationTrigger;
  /** Gate script result for this iteration — present when a gate ran after this iteration. */
  gate_result?: GateResult | null;
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
  /** Unified task state (replaces old status + phase). */
  state: TaskState;
  /** Artifacts produced so far, keyed by artifact name. */
  artifacts: Record<string, WorkflowArtifact>;
  /** External resources registered by agents, keyed by resource name. */
  resources: Record<string, WorkflowResource>;
  /** Parent task ID (for subtasks). */
  parent_id?: string;
  /** Short display ID for subtasks (last word of full ID, e.g., "bird"), unique within a parent. */
  short_id?: string;
  /** Task IDs this task depends on. */
  depends_on: string[];
  /** Git branch name. */
  branch_name?: string;
  /** Git worktree path. */
  worktree_path?: string;
  /** Pull request URL (if PR was created). */
  pr_url?: string;
  /** The branch this task was created from (merge/rebase target). Always set at creation. */
  base_branch: string;
  /** Git commit SHA of the base branch at the time the worktree was created. */
  base_commit: string;
  /** Whether the task runs autonomously through all stages. */
  auto_mode: boolean;
  /** Named flow for this task (e.g., "quick", "hotfix"). Always set — "default" for the main pipeline. */
  flow: string;
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
export type SessionState = "spawning" | "active" | "completed" | "abandoned" | "superseded";

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

/**
 * Information about a single session within a stage for log display.
 */
export interface SessionLogInfo {
  /** The unique session ID (UUID). */
  session_id: string;
  /** The run number within this stage (1-indexed, ordered chronologically). */
  run_number: number;
  /** Whether this is the current (non-superseded) session. */
  is_current: boolean;
  /** When this session was created (RFC3339). */
  created_at: string;
}

/**
 * Information about a stage's log sessions.
 */
export interface StageLogInfo {
  /** The stage name. */
  stage: string;
  /** All sessions for this stage that have logs, ordered chronologically. */
  sessions: SessionLogInfo[];
}

// =============================================================================
// Derived Task State
// =============================================================================

/**
 * A pending rejection from a reviewer agent awaiting human confirmation.
 */
export interface PendingRejection {
  /** The stage that produced the rejection (e.g., "review"). */
  from_stage: string;
  /** The target stage the rejection would send work to (e.g., "work"). */
  target: string;
  /** The agent's rejection feedback. */
  feedback: string;
}

/**
 * Pre-computed state derived from task + iterations + sessions.
 * Computed once in the Rust backend — the single source of truth.
 */
export interface DerivedTaskState {
  current_stage: string | null;
  is_working: boolean;
  is_system_active: boolean;
  is_preparing: boolean;
  phase_icon: string | null;
  is_interrupted: boolean;
  is_failed: boolean;
  is_blocked: boolean;
  is_done: boolean;
  is_archived: boolean;
  is_terminal: boolean;
  is_waiting_on_children: boolean;
  needs_review: boolean;
  has_questions: boolean;
  pending_questions: WorkflowQuestion[];
  rejection_feedback: string | null;
  pending_rejection: PendingRejection | null;
  /** Whether the current stage's agent verdict was approval (approval-capability stages only). */
  pending_approval: boolean;
  stages_with_logs: StageLogInfo[];
  subtask_progress: SubtaskProgress | null;
  is_chatting: boolean;
  chat_agent_active: boolean;
  /** Whether the task is in interactive (user-directed) mode. */
  is_interactive: boolean;
  /** Whether the task can be bypassed (skip/send-to-stage/restart/enter-interactive). */
  can_bypass: boolean;
}

/**
 * Progress summary for a parent task's subtasks.
 */
export interface SubtaskProgress {
  total: number;
  done: number;
  failed: number;
  blocked: number;
  interrupted: number;
  has_questions: number;
  needs_review: number;
  working: number;
  /** Idle/waiting — not in any of the above states. */
  waiting: number;
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
// Differential Sync
// =============================================================================

/**
 * Response shape for differential task sync.
 *
 * Returned by `list_tasks` when called with a `since` timestamp map.
 * Contains only tasks whose `updated_at` has changed plus IDs of deleted tasks.
 */
export interface DifferentialTaskResponse {
  /** Tasks that are new or have changed since the client's last known timestamps. */
  tasks: WorkflowTaskView[];
  /** IDs of tasks that were in the client's timestamp map but are no longer active. */
  deleted_ids: string[];
}

// =============================================================================
// Log Pagination
// =============================================================================

/**
 * Response shape for cursor-based incremental log fetching.
 * Returned by `get_logs` when using cursor-based pagination.
 */
export interface LogPage {
  /** Log entries returned since the last cursor. */
  entries: LogEntry[];
  /** Max sequence_number of the returned entries — use as cursor for the next fetch.
   * Null when no entries were returned. */
  cursor: number | null;
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
  | { tool: "agent"; description: string }
  | { tool: "todo_write"; todos: TodoItem[] }
  | { tool: "ork"; ork_action: OrkAction }
  | { tool: "structured_output"; output_type: string }
  | { tool: "web_search"; query: string }
  | { tool: "web_fetch"; url: string }
  | { tool: "other"; summary: string };

/**
 * Resume type for session resumption markers.
 * - "continue": Agent was interrupted, continue from where left off
 * - "feedback": Human provided feedback to address
 * - "integration": Integration failed with merge conflict
 * - "answers": Human provided answers to questions
 * - "retry_failed": Human retried a failed task
 * - "retry_blocked": Human retried a blocked task
 * - "manual_resume": User interrupted and resumed with optional message
 * - "initial": Initial agent prompt (first spawn)
 */
export type ResumeType =
  | "continue"
  | "feedback"
  | "integration"
  | "answers"
  | "recheck"
  | "retry_failed"
  | "retry_blocked"
  | "manual_resume"
  | "initial"
  | "chat"
  | "return_to_work";

/**
 * Structured log entry for task execution (loaded from Claude's session files).
 * Uses snake_case type field to match Rust's serde serialization.
 */
export type LogEntry =
  | { type: "text"; content: string }
  | {
      type: "user_message";
      /** Type of resume marker (e.g., "continue", "feedback", "manual_resume"). Defaults to "continue". */
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
  | { type: "error"; message: string };

// =============================================================================
// PR Status
// =============================================================================

/**
 * Status of a pull request fetched from GitHub.
 */
export interface PrStatus {
  /** The PR URL. */
  url: string;
  /** PR state: "open", "merged", or "closed". */
  state: "open" | "merged" | "closed";
  /** CI/CD check statuses. */
  checks: PrCheck[];
  /** Review statuses. */
  reviews: PrReview[];
  /** Review comments on the PR. */
  comments: PrComment[];
  /** Timestamp when this status was fetched (RFC3339). */
  fetched_at: string;
  /** Whether the PR can be merged (false if conflicts exist). */
  mergeable: boolean | null;
  /** GitHub merge state status. "DIRTY" indicates conflicts. */
  merge_state_status: string | null;
}

/**
 * A single CI/CD check status.
 */
export interface PrCheck {
  /** Name of the check (e.g., "tests", "lint"). */
  name: string;
  /** Status: "pending", "success", "failure", or "skipped". */
  status: "pending" | "success" | "failure" | "skipped";
  /** Conclusion if completed (e.g., "SUCCESS", "FAILURE"). */
  conclusion?: string;
  /** Internal check run ID, if available. */
  id?: number;
  /** Parsed error excerpt from the CI job log, if available. */
  log_excerpt?: string;
}

/**
 * A single review status.
 */
export interface PrReview {
  /** GitHub review ID. */
  id: number;
  /** GitHub username of the reviewer. */
  author: string;
  /** Review state from GitHub (uppercase): "APPROVED", "CHANGES_REQUESTED", "COMMENTED", or "PENDING". */
  state: string;
  /** Review body text. Null if the review has no body. */
  body: string | null;
  /** When the review was submitted (ISO 8601). */
  submitted_at: string;
}

/**
 * A single PR review comment.
 */
export interface PrComment {
  /** GitHub comment ID. */
  id: number;
  /** GitHub username of the commenter. */
  author: string;
  /** Comment body (markdown). */
  body: string;
  /** File path for file-level or line-level comments. Null for general comments. */
  path: string | null;
  /** Line number for line-level comments. Null for file-level or general comments. */
  line: number | null;
  /** When the comment was created (ISO 8601). */
  created_at: string;
  /** Parent review ID if this comment belongs to a review. Null for standalone comments. */
  review_id: number | null;
  /** Whether the referenced code has changed since this comment was left. */
  outdated: boolean;
}

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
  /** Latest commit message (first line). */
  latest_commit_message: string | null;
}

/**
 * Sync status relative to origin for the current branch.
 * Returned by workflow_git_sync_status.
 */
export interface SyncStatus {
  /** Commits ahead of origin (need to push). */
  ahead: number;
  /** Commits behind origin (need to pull). */
  behind: number;
  /** Whether local and remote have diverged (both have commits the other lacks). */
  diverged: boolean;
}

/**
 * Commit metadata returned by workflow_get_commit_log.
 */
export interface CommitInfo {
  /** Short commit hash (7 chars). */
  hash: string;
  /** First line of commit message. */
  message: string;
  /** Commit message body (lines after subject), null for single-line commits. */
  body: string | null;
  /** Author name. */
  author: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Number of files changed in this commit (null when not yet loaded). */
  file_count: number | null;
}

/**
 * Response shape for get_branch_commits — includes uncommitted change flag.
 */
export interface BranchCommitsResponse {
  commits: CommitInfo[];
  has_uncommitted_changes: boolean;
}

// =============================================================================
// Assistant Sessions
// =============================================================================

/**
 * An assistant chat session.
 */
export interface AssistantSession {
  /** Unique session ID. */
  id: string;
  /** Claude session ID (for Claude Code --resume). */
  claude_session_id: string | null;
  /** Session title (generated from first message). */
  title: string | null;
  /** Current agent process PID (null if not running). */
  agent_pid: number | null;
  /** Number of times the agent has been spawned for this session. */
  spawn_count: number;
  /** Session state (spawning, active, completed, abandoned). */
  session_state: string;
  /** Session type: "assistant" for read-only chat, "interactive" for edit-capable sessions. */
  session_type: "assistant" | "interactive";
  /** Task ID for task-scoped sessions. Undefined for project-level sessions. */
  task_id?: string;
  /** When the session was created. */
  created_at: string;
  /** When the session was last updated. */
  updated_at: string;
}
