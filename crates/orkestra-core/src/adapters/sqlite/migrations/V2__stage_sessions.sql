-- Stage sessions: one Claude session per task+stage combination

CREATE TABLE IF NOT EXISTS stage_sessions (
    task_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    session_id TEXT,
    agent_pid INTEGER,
    started_at TEXT NOT NULL,
    PRIMARY KEY (task_id, stage),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_stage_sessions_task ON stage_sessions(task_id);
