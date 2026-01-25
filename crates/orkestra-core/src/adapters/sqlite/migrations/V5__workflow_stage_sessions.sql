-- Stage sessions for workflow system: one Claude session per task+stage combination
-- This tracks session continuity across iterations within a stage.

CREATE TABLE IF NOT EXISTS workflow_stage_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    claude_session_id TEXT,
    agent_pid INTEGER,
    resume_count INTEGER NOT NULL DEFAULT 0,
    session_state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (task_id) REFERENCES workflow_tasks(id),
    UNIQUE(task_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_workflow_stage_sessions_task ON workflow_stage_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_sessions_active ON workflow_stage_sessions(session_state)
    WHERE session_state = 'active';
CREATE INDEX IF NOT EXISTS idx_workflow_stage_sessions_pids ON workflow_stage_sessions(agent_pid)
    WHERE agent_pid IS NOT NULL;

-- Add stage_session_id to iterations (optional - iterations reference their parent session)
ALTER TABLE workflow_iterations ADD COLUMN stage_session_id TEXT
    REFERENCES workflow_stage_sessions(id);
