-- Add interactive flag to workflow_tasks
ALTER TABLE workflow_tasks ADD COLUMN interactive INTEGER NOT NULL DEFAULT 0;

-- Add session_type to assistant_sessions to distinguish interactive from assistant sessions
ALTER TABLE assistant_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'assistant';

-- Drop old unique index on (task_id) and replace with (task_id, session_type) so each task
-- can have one assistant session and one interactive session simultaneously.
DROP INDEX IF EXISTS idx_assistant_sessions_task_id;
CREATE UNIQUE INDEX idx_assistant_sessions_task_id_type
    ON assistant_sessions(task_id, session_type)
    WHERE task_id IS NOT NULL;
