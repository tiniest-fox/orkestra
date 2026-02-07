-- Add assistant_sessions table and make log_entries support both stage and assistant sessions

-- Create assistant_sessions table
CREATE TABLE assistant_sessions (
    id TEXT PRIMARY KEY,
    claude_session_id TEXT,
    title TEXT,
    agent_pid INTEGER,
    spawn_count INTEGER NOT NULL DEFAULT 0,
    session_state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_assistant_sessions_state ON assistant_sessions(session_state);
CREATE INDEX idx_assistant_sessions_created ON assistant_sessions(created_at);

-- Recreate log_entries table with nullable stage_session_id and new assistant_session_id column
-- SQLite migration pattern: create new table, copy data, drop old, rename

CREATE TABLE log_entries_new (
    id TEXT PRIMARY KEY,
    stage_session_id TEXT,
    assistant_session_id TEXT,
    sequence_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (stage_session_id) REFERENCES workflow_stage_sessions(id),
    FOREIGN KEY (assistant_session_id) REFERENCES assistant_sessions(id),
    UNIQUE(stage_session_id, sequence_number),
    UNIQUE(assistant_session_id, sequence_number)
);

-- Copy existing data (all have stage_session_id, none have assistant_session_id)
INSERT INTO log_entries_new (id, stage_session_id, assistant_session_id, sequence_number, content, created_at)
SELECT id, stage_session_id, NULL, sequence_number, content, created_at FROM log_entries;

-- Drop old table
DROP TABLE log_entries;

-- Rename new table
ALTER TABLE log_entries_new RENAME TO log_entries;

-- Ensure exactly one FK is set per log entry
CREATE TRIGGER check_log_entry_fk_insert
BEFORE INSERT ON log_entries
BEGIN
    SELECT CASE
        WHEN (NEW.stage_session_id IS NULL AND NEW.assistant_session_id IS NULL) THEN
            RAISE(ABORT, 'log_entries must have either stage_session_id or assistant_session_id')
        WHEN (NEW.stage_session_id IS NOT NULL AND NEW.assistant_session_id IS NOT NULL) THEN
            RAISE(ABORT, 'log_entries cannot have both stage_session_id and assistant_session_id')
    END;
END;

CREATE TRIGGER check_log_entry_fk_update
BEFORE UPDATE ON log_entries
BEGIN
    SELECT CASE
        WHEN (NEW.stage_session_id IS NULL AND NEW.assistant_session_id IS NULL) THEN
            RAISE(ABORT, 'log_entries must have either stage_session_id or assistant_session_id')
        WHEN (NEW.stage_session_id IS NOT NULL AND NEW.assistant_session_id IS NOT NULL) THEN
            RAISE(ABORT, 'log_entries cannot have both stage_session_id and assistant_session_id')
    END;
END;
