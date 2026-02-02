-- Orkestra database schema.
--
-- Four tables: tasks, iterations, stage sessions, and log entries.
-- All workflow state lives here — the orchestrator, agents, and UI
-- all read/write through the WorkflowStore trait.

-- =============================================================================
-- Tasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS workflow_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,

    -- Workflow position: JSON like {"type":"active","stage":"planning"} or {"type":"done"}
    status TEXT NOT NULL,

    -- Execution phase: idle, setting_up, agent_working, awaiting_review, integrating
    phase TEXT NOT NULL DEFAULT 'idle',

    -- Stage outputs (plan, summary, etc.) as JSON: {"plan": {...}, "summary": {...}}
    artifacts TEXT NOT NULL DEFAULT '{}',

    -- Hierarchy
    parent_id TEXT,
    short_id TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',

    -- Git
    branch_name TEXT,
    worktree_path TEXT,
    base_branch TEXT NOT NULL DEFAULT '',

    -- Configuration
    auto_mode INTEGER NOT NULL DEFAULT 0,
    flow TEXT,

    -- Tracking
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,

    FOREIGN KEY (parent_id) REFERENCES workflow_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_parent ON workflow_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON workflow_tasks(status);

-- =============================================================================
-- Iterations (one per agent/script run within a stage)
-- =============================================================================

CREATE TABLE IF NOT EXISTS workflow_iterations (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    iteration_number INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,

    -- How the iteration ended: JSON like {"type":"approved"} or {"type":"rejected","feedback":"..."}
    outcome TEXT,

    -- Links to the stage session that ran this iteration
    stage_session_id TEXT,

    -- Why this iteration was created: JSON trigger context (feedback, integration failure, etc.)
    incoming_context TEXT,

    -- Whether the trigger prompt has been delivered to the agent
    trigger_delivered INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (task_id) REFERENCES workflow_tasks(id),
    FOREIGN KEY (stage_session_id) REFERENCES workflow_stage_sessions(id),
    UNIQUE(task_id, stage, iteration_number)
);

CREATE INDEX IF NOT EXISTS idx_workflow_iterations_task ON workflow_iterations(task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_iterations_task_stage ON workflow_iterations(task_id, stage);

-- =============================================================================
-- Stage Sessions (tracks agent process continuity across iterations)
-- =============================================================================

CREATE TABLE IF NOT EXISTS workflow_stage_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    stage TEXT NOT NULL,

    -- Agent session tracking
    claude_session_id TEXT,
    agent_pid INTEGER,
    spawn_count INTEGER NOT NULL DEFAULT 0,

    -- Session lifecycle: spawning, active, completed, abandoned
    session_state TEXT NOT NULL DEFAULT 'active',

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (task_id) REFERENCES workflow_tasks(id)
);

-- =============================================================================
-- Log Entries (structured logs from agent sessions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_entries (
    id TEXT PRIMARY KEY,
    stage_session_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,

    -- JSON-encoded LogEntry (text, tool_use, tool_result, etc.)
    content TEXT NOT NULL,

    created_at TEXT NOT NULL,

    FOREIGN KEY (stage_session_id) REFERENCES workflow_stage_sessions(id),
    UNIQUE(stage_session_id, sequence_number)
);
