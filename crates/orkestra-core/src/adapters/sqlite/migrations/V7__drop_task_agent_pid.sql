-- Remove agent_pid from workflow_tasks table.
-- Agent tracking is now done via workflow_stage_sessions.agent_pid instead.
-- Requires SQLite 3.35.0+ for DROP COLUMN support.

ALTER TABLE workflow_tasks DROP COLUMN agent_pid;
