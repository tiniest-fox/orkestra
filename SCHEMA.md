# Database Schema

This document describes the SQLite database schema used by Orkestra. The schema is defined in `crates/orkestra-core/src/adapters/sqlite/migrations/V1__initial_schema.sql`.

## Overview

Orkestra stores all workflow state in a SQLite database at `.orkestra/.database/orkestra.db`. The schema consists of five tables:

- **`workflow_tasks`** — Task definitions, status, artifacts, and configuration
- **`workflow_iterations`** — Individual agent/script runs within stages
- **`workflow_stage_sessions`** — Agent process session tracking for task-specific work
- **`assistant_sessions`** — Agent process session tracking for project-level assistant chat
- **`log_entries`** — Structured logs from agent sessions (both stage and assistant sessions)

All workflow state is accessed through the `WorkflowStore` trait. The orchestrator, agents, and UI read/write exclusively through this interface.

---

## Tables

### `workflow_tasks`

Stores task definitions, workflow position, execution phase, artifacts, and git state.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique task identifier (e.g., `"only-decisive-chiffchaff"`) |
| `title` | TEXT | NOT NULL | Human-readable task title |
| `description` | TEXT | NOT NULL | Task description or user request |
| `status` | TEXT | NOT NULL | Workflow position as JSON. Examples: `{"type":"active","stage":"planning"}`, `{"type":"done"}`, `{"type":"blocked","reason":"..."}`, `{"type":"waiting_on_children"}` |
| `phase` | TEXT | NOT NULL, DEFAULT 'idle' | Execution phase: `idle`, `setting_up`, `agent_working`, `awaiting_review`, `integrating` |
| `artifacts` | TEXT | NOT NULL, DEFAULT '{}' | Stage outputs as JSON object. Keys are artifact names (e.g., `plan`, `summary`), values are artifact content |
| `parent_id` | TEXT | FOREIGN KEY → workflow_tasks(id) | Parent task ID for subtasks |
| `short_id` | TEXT | | Short identifier for subtasks (e.g., `"1.2"`) |
| `depends_on` | TEXT | NOT NULL, DEFAULT '[]' | JSON array of task IDs this task depends on |
| `branch_name` | TEXT | | Git branch name for this task's worktree |
| `worktree_path` | TEXT | | Absolute path to git worktree (e.g., `.orkestra/.worktrees/{task-id}`) |
| `base_branch` | TEXT | NOT NULL, DEFAULT '' | Base branch to merge into when task completes |
| `base_commit` | TEXT | NOT NULL, DEFAULT '' | Git commit SHA of the base branch at the time the worktree was created |
| `auto_mode` | INTEGER | NOT NULL, DEFAULT 0 | Boolean: auto-approve stages without human review (1 = true, 0 = false) |
| `flow` | TEXT | | Named flow (alternate pipeline) to use instead of default stage sequence |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `completed_at` | TEXT | | ISO 8601 timestamp, set when task reaches `done` status |

**Indexes:**
- `idx_workflow_tasks_parent` on `parent_id`
- `idx_workflow_tasks_status` on `status`

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
| `session_state` | TEXT | NOT NULL, DEFAULT 'active' | Session lifecycle state: `spawning`, `active`, `completed`, `abandoned` |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 timestamp |

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
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |

**Constraints:**
- Exactly one of `stage_session_id` or `assistant_session_id` must be set (enforced by triggers)
- `sequence_number` is unique per session (regardless of session type)

---

## Relationships

```
workflow_tasks
    ├─> workflow_tasks (self-referential: parent_id)
    ├─> workflow_iterations (task_id)
    └─> workflow_stage_sessions (task_id)

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

1. Create a new migration file in `crates/orkestra-core/src/adapters/sqlite/migrations/` following Refinery naming conventions (e.g., `V2__add_priority.sql`)
2. Update this document to reflect the new schema
3. Update the Architecture Overview section in `CLAUDE.md` if the changes are significant

This ensures the schema documentation stays synchronized with the actual database structure.
