-- Remove deprecated session_id column from workflow_iterations
-- Session tracking is now handled by workflow_stage_sessions via stage_session_id

-- SQLite doesn't support DROP COLUMN, so we recreate the table
CREATE TABLE workflow_iterations_new (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    iteration_number INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    outcome TEXT,
    stage_session_id TEXT REFERENCES workflow_stage_sessions(id),

    FOREIGN KEY (task_id) REFERENCES workflow_tasks(id),
    UNIQUE(task_id, stage, iteration_number)
);

-- Copy data (excluding deprecated session_id)
INSERT INTO workflow_iterations_new (id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id)
SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id
FROM workflow_iterations;

-- Drop old table and rename
DROP TABLE workflow_iterations;
ALTER TABLE workflow_iterations_new RENAME TO workflow_iterations;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_workflow_iterations_task ON workflow_iterations(task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_iterations_task_stage ON workflow_iterations(task_id, stage);
