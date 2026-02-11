-- Performance indexes for orchestrator tick, frontend queries, and log lookups.

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_phase ON workflow_tasks(phase);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_sessions_task ON workflow_stage_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_log_entries_session ON log_entries(stage_session_id);
