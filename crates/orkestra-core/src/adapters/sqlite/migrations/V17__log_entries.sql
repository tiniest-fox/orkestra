-- Log entries table for persisting agent execution logs.
CREATE TABLE log_entries (
    id TEXT PRIMARY KEY,
    stage_session_id TEXT NOT NULL REFERENCES workflow_stage_sessions(id),
    sequence_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(stage_session_id, sequence_number)
);
CREATE INDEX idx_log_entries_session ON log_entries(stage_session_id, sequence_number);
