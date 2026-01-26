-- Cleanup migration: drop deprecated columns and legacy tables.
--
-- 1. Drop pending_questions and question_history from workflow_tasks
--    (now stored in iteration outcomes/context)
-- 2. Drop legacy tables from old task system

-- ============================================================================
-- Part 1: Drop deprecated question fields from workflow_tasks
-- ============================================================================

-- SQLite doesn't support DROP COLUMN directly, so we recreate the table.
CREATE TABLE workflow_tasks_new (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'idle',
    artifacts TEXT NOT NULL DEFAULT '{}',
    parent_id TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',
    branch_name TEXT,
    worktree_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (parent_id) REFERENCES workflow_tasks_new(id)
);

-- Copy data (excluding pending_questions and question_history)
INSERT INTO workflow_tasks_new (
    id, title, description, status, phase, artifacts,
    parent_id, depends_on, branch_name, worktree_path,
    created_at, updated_at, completed_at
)
SELECT
    id, title, description, status, phase, artifacts,
    parent_id, depends_on, branch_name, worktree_path,
    created_at, updated_at, completed_at
FROM workflow_tasks;

-- Drop old table and rename new one
DROP TABLE workflow_tasks;
ALTER TABLE workflow_tasks_new RENAME TO workflow_tasks;

-- Recreate indexes
CREATE INDEX idx_workflow_tasks_parent ON workflow_tasks(parent_id);
CREATE INDEX idx_workflow_tasks_status ON workflow_tasks(status);

-- ============================================================================
-- Part 2: Drop legacy tables from old task system
-- ============================================================================

-- Drop indexes first
DROP INDEX IF EXISTS idx_tasks_status;
DROP INDEX IF EXISTS idx_tasks_parent_id;
DROP INDEX IF EXISTS idx_work_loops_task_id;
DROP INDEX IF EXISTS idx_stage_sessions_task;
DROP INDEX IF EXISTS idx_iterations_task_stage;

-- Drop legacy tables
DROP TABLE IF EXISTS iterations;
DROP TABLE IF EXISTS stage_sessions;
DROP TABLE IF EXISTS work_loops;
DROP TABLE IF EXISTS tasks;
