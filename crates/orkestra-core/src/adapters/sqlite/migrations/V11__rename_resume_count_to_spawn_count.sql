-- Rename resume_count to spawn_count in workflow_stage_sessions
-- The field now tracks spawn count (incremented at spawn time, not exit time)
-- to ensure crash recovery correctly uses --resume

ALTER TABLE workflow_stage_sessions RENAME COLUMN resume_count TO spawn_count;
