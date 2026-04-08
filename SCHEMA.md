# Database Schema

This document describes the SQLite database schema used by Orkestra. The schema is defined in `crates/orkestra-store/src/migrations/`.

## Overview

Orkestra stores all workflow state in a SQLite database at `.orkestra/.database/orkestra.db`. The schema consists of eight tables:

- **`workflow_tasks`** — Trak definitions, status, artifacts, and configuration
- **`workflow_iterations`** — Individual agent/script runs within stages
- **`workflow_stage_sessions`** — Agent process session tracking for Trak-specific work
- **`assistant_sessions`** — Agent process session tracking for project-level assistant chat
- **`log_entries`** — Structured logs from agent sessions (both stage and assistant sessions)
- **`workflow_artifacts`** — Named artifact outputs produced by stage agents, keyed by (task_id, name)
- **`device_tokens`** — Authenticated remote devices (WebSocket clients via `orkd`)
- **`pairing_codes`** — Short-lived 6-digit codes used to bootstrap device authentication

All workflow state is accessed through the `WorkflowStore` trait. The orchestrator, agents, and UI read/write exclusively through this interface.

---

## Tables

### `workflow_tasks`

Stores Trak definitions, workflow position, execution phase, artifacts, and git state.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique task identifier (e.g., `"only-decisive-chiffchaff"`) |
| `title` | TEXT | NOT NULL | Human-readable task title |
| `description` | TEXT | NOT NULL | Task description or user request |
| `status` | TEXT | NOT NULL | Workflow position as JSON. Examples: `{"type":"active","stage":"planning"}`, `{"type":"done"}`, `{"type":"blocked","reason":"..."}`, `{"type":"waiting_on_children"}` |
| `phase` | TEXT | NOT NULL, DEFAULT 'idle' | Execution phase: `idle`, `setting_up`, `agent_working`, `awaiting_review`, `integrating` |
| `artifacts` | TEXT | NOT NULL, DEFAULT '{}' | Stage outputs as JSON object. Keys are artifact names (e.g., `plan`, `summary`), values are artifact content |
| `resources` | TEXT | NOT NULL, DEFAULT '{}' | External resources as JSON object. Keys are resource names, values are resource records (url, description, stage, created_at) |
| `parent_id` | TEXT | FOREIGN KEY → workflow_tasks(id) | Parent task ID for subtasks |
| `short_id` | TEXT | | Short identifier for subtasks (e.g., `"1.2"`) |
| `depends_on` | TEXT | NOT NULL, DEFAULT '[]' | JSON array of task IDs this task depends on |
| `branch_name` | TEXT | | Git branch name for this task's worktree |
| `worktree_path` | TEXT | | Absolute path to git worktree (e.g., `.orkestra/.worktrees/{task-id}`) |
| `base_branch` | TEXT | NOT NULL, DEFAULT '' | Base branch to merge into when task completes |
| `base_commit` | TEXT | NOT NULL, DEFAULT '' | Git commit SHA of the base branch at the time the worktree was created |
| `pr_url` | TEXT | | URL of the pull request created for this task's branch |
| `auto_mode` | INTEGER | NOT NULL, DEFAULT 0 | Boolean: auto-approve stages without human review (1 = true, 0 = false) |
| `flow` | TEXT | NOT NULL DEFAULT 'default' | Named flow (complete pipeline) for this task. "default" for the main pipeline. |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `completed_at` | TEXT | | ISO 8601 timestamp, set when task reaches `done` status |

**Indexes:**
- `idx_workflow_tasks_parent` on `parent_id`
- `idx_workflow_tasks_status` on `status`
- `idx_workflow_tasks_phase` on `phase`

---

### `workflow_iterations`

Tracks individual agent/script runs within a stage. Each stage execution creates an iteration. Rejections create new iterations with feedback.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique iteration identifier |
| `task_id` | TEXT | NOT NULL, FOREIGN KEY → workflow_tasks(id) | Associated task |
| `stage` | TEXT | NOT NULL | Stage name (e.g., `"planning"`, `"work"`, `"review"`) |
| `iteration_number` | INTEGER | NOT NULL, UNIQUE(task_id, stage, iteration_number) | Iteration count within this task/stage combination (1-indexed) |
| `started_at` | TEXT | NOT NULL | ISO 8601 timestamp when iteration began |
| `ended_at` | TEXT | | ISO 8601 timestamp when iteration completed |
| `outcome` | TEXT | | How the iteration ended, as JSON: `{"type":"approved"}`, `{"type":"rejected","feedback":"..."}`, `{"type":"failed","error":"..."}` |
| `stage_session_id` | TEXT | FOREIGN KEY → workflow_stage_sessions(id) | Links to the agent session that executed this iteration |
| `incoming_context` | TEXT | | JSON trigger context explaining why this iteration was created (feedback from rejection, integration failure, etc.) |
| `trigger_delivered` | INTEGER | NOT NULL, DEFAULT 0 | Boolean: whether the trigger prompt has been delivered to the agent (1 = delivered, 0 = pending) |
| `activity_log` | TEXT | | Short narrative summary of what the agent did during this iteration. Only present on work-completing outputs (artifact, approval, subtasks). |
| `artifact_snapshot` | TEXT | | JSON-encoded artifact snapshot capturing artifact name and content when the agent produces output. Preserves artifact history across rejections. |

**Indexes:**
- `idx_workflow_iterations_task` on `task_id`
- `idx_workflow_iterations_task_stage` on `(task_id, stage)`

---

### `workflow_stage_sessions`

Tracks agent process continuity across iterations. Enables session recovery via `--resume` (Claude Code) or `--continue` (OpenCode).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique session identifier |
| `task_id` | TEXT | NOT NULL, FOREIGN KEY → workflow_tasks(id) | Associated task |
| `stage` | TEXT | NOT NULL | Stage name this session is executing |
| `claude_session_id` | TEXT | | Agent CLI session ID for recovery (e.g., Claude Code session token) |
| `agent_pid` | INTEGER | | Process ID of the running agent |
| `spawn_count` | INTEGER | NOT NULL, DEFAULT 0 | Number of times the agent process has been spawned for this session |
| `has_activity` | INTEGER | NOT NULL, DEFAULT 0 | Whether the agent produced any output during this session (1 = yes, 0 = no). Used to determine if resume is safe. |
| `session_state` | TEXT | NOT NULL, DEFAULT 'active' | Session lifecycle state: `spawning`, `active`, `completed`, `abandoned` |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 timestamp |

**Indexes:**
- `idx_workflow_stage_sessions_task` on `task_id`

---

### `assistant_sessions`

Tracks agent sessions for project-level assistant chat. Unlike stage sessions (which are tied to tasks), assistant sessions are independent and provide persistent chat at the project level.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique session identifier |
| `claude_session_id` | TEXT | | Agent CLI session ID for recovery (e.g., Claude Code session token) |
| `title` | TEXT | | Optional user-provided title for the session |
| `agent_pid` | INTEGER | | Process ID of the running agent |
| `spawn_count` | INTEGER | NOT NULL, DEFAULT 0 | Number of times the agent process has been spawned for this session |
| `session_state` | TEXT | NOT NULL, DEFAULT 'active' | Session lifecycle state: `spawning`, `active`, `completed`, `abandoned` |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 timestamp |

**Indexes:**
- `idx_assistant_sessions_state` on `session_state`
- `idx_assistant_sessions_created` on `created_at`

---

### `log_entries`

Stores structured logs from agent sessions. Each entry is a serialized `LogEntry` containing text messages, tool uses, tool results, etc. Log entries can belong to either a stage session (task-specific work) or an assistant session (project-level chat), but not both.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique log entry identifier |
| `stage_session_id` | TEXT | FOREIGN KEY → workflow_stage_sessions(id) | Associated stage session (XOR with assistant_session_id) |
| `assistant_session_id` | TEXT | FOREIGN KEY → assistant_sessions(id) | Associated assistant session (XOR with stage_session_id) |
| `sequence_number` | INTEGER | NOT NULL, UNIQUE(stage_session_id, sequence_number), UNIQUE(assistant_session_id, sequence_number) | Monotonically increasing sequence within the session |
| `content` | TEXT | NOT NULL | JSON-encoded LogEntry object (text, tool_use, tool_result, etc.) |
| `iteration_id` | TEXT | | ID of the active iteration when this log entry was written. NULL for chat-mode messages. |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |

**Constraints:**
- Exactly one of `stage_session_id` or `assistant_session_id` must be set (enforced by triggers)
- `sequence_number` is unique per session (regardless of session type)

**Indexes:**
- `idx_log_entries_session` on `stage_session_id`

---

### `workflow_artifacts`

Stores named artifact outputs produced by stage agents. Each row represents the latest version of an artifact for a task — new output from the same stage replaces the previous row for that name.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `task_id` | TEXT | NOT NULL, FOREIGN KEY → workflow_tasks(id) | Associated task |
| `name` | TEXT | NOT NULL | Artifact name (e.g., `"plan"`, `"summary"`) |
| `content` | TEXT | NOT NULL | Artifact content (markdown) |
| `html` | TEXT | | Pre-rendered HTML from the markdown content |
| `stage` | TEXT | NOT NULL | Stage that produced this artifact |
| `iteration` | INTEGER | NOT NULL, DEFAULT 1 | Iteration number that produced this artifact |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp when the artifact was created |

**Primary Key:** `(task_id, name)` — one artifact per name per task

**Indexes:**
- `idx_workflow_artifacts_task` on `task_id`

---

### `device_tokens`

Stores authenticated remote devices that can connect to the `orkd` WebSocket server. Token hashes (SHA-256) are stored, never raw tokens.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique device identifier (UUID v4) |
| `device_name` | TEXT | NOT NULL | Human-readable name provided during pairing |
| `token_hash` | TEXT | NOT NULL | SHA-256 hex digest of the bearer token |
| `created_at` | TEXT | NOT NULL, DEFAULT datetime('now') | ISO 8601 timestamp when the device was paired |
| `last_used_at` | TEXT | | ISO 8601 timestamp of the most recent authenticated connection |
| `revoked` | INTEGER | NOT NULL, DEFAULT 0 | Boolean: 1 if the device has been revoked |

---

### `pairing_codes`

Short-lived 6-digit numeric codes generated by the daemon to bootstrap device authentication. Codes expire after 5 minutes and can only be claimed once.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `code` | TEXT | PRIMARY KEY | 6-digit numeric string (e.g., `"042317"`) |
| `created_at` | TEXT | NOT NULL, DEFAULT datetime('now') | ISO 8601 timestamp when the code was generated |
| `expires_at` | TEXT | NOT NULL | ISO 8601 timestamp when the code expires (5 minutes after creation) |
| `claimed` | INTEGER | NOT NULL, DEFAULT 0 | Boolean: 1 if the code has been exchanged for a token |

---

## Relationships

```
workflow_tasks
    ├─> workflow_tasks (self-referential: parent_id)
    ├─> workflow_iterations (task_id)
    ├─> workflow_stage_sessions (task_id)
    └─> workflow_artifacts (task_id)

workflow_iterations
    └─> workflow_stage_sessions (stage_session_id)

workflow_stage_sessions
    └─> log_entries (stage_session_id)

assistant_sessions
    └─> log_entries (assistant_session_id)
```

---

## Schema Evolution

**When adding or modifying migrations:**

1. Create a new migration file in `crates/orkestra-store/src/migrations/` following Refinery naming conventions (e.g., `V2__add_priority.sql`)
2. Update this document to reflect the new schema
3. Update the Architecture Overview section in `CLAUDE.md` if the changes are significant

This ensures the schema documentation stays synchronized with the actual database structure.
