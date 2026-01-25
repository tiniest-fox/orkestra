-- New workflow system tables (standalone, stage-agnostic)
-- These tables support the configurable workflow system where stages are strings, not enums.

-- Workflow tasks table (stage-agnostic)
CREATE TABLE IF NOT EXISTS workflow_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,

    -- Status: JSON object like {"type":"active","stage":"planning"} or {"type":"done"}
    status TEXT NOT NULL,

    -- Phase: idle, agent_working, awaiting_review, integrating
    phase TEXT NOT NULL DEFAULT 'idle',

    -- Artifacts: JSON object mapping artifact names to artifact data
    artifacts TEXT NOT NULL DEFAULT '{}',

    -- Questions: JSON arrays
    pending_questions TEXT NOT NULL DEFAULT '[]',
    question_history TEXT NOT NULL DEFAULT '[]',

    -- Hierarchy
    parent_id TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',

    -- Git
    branch_name TEXT,
    worktree_path TEXT,

    -- Tracking
    agent_pid INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,

    FOREIGN KEY (parent_id) REFERENCES workflow_tasks(id)
);

-- Workflow iterations table (stage-agnostic)
CREATE TABLE IF NOT EXISTS workflow_iterations (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    iteration_number INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    outcome TEXT,
    session_id TEXT,

    FOREIGN KEY (task_id) REFERENCES workflow_tasks(id),
    UNIQUE(task_id, stage, iteration_number)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_parent ON workflow_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON workflow_tasks(status);
CREATE INDEX IF NOT EXISTS idx_workflow_iterations_task ON workflow_iterations(task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_iterations_task_stage ON workflow_iterations(task_id, stage);
