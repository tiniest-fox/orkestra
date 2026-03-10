ALTER TABLE assistant_sessions ADD COLUMN task_id TEXT;
CREATE UNIQUE INDEX idx_assistant_sessions_task_id ON assistant_sessions(task_id) WHERE task_id IS NOT NULL;
