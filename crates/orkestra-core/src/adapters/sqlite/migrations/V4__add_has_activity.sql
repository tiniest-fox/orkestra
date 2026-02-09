-- Add has_activity column to workflow_stage_sessions
-- Tracks whether the agent has produced any output during the session
ALTER TABLE workflow_stage_sessions ADD COLUMN has_activity INTEGER NOT NULL DEFAULT 0;
