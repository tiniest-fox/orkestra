-- Add short_id column for subtask display labels.
ALTER TABLE workflow_tasks ADD COLUMN short_id TEXT DEFAULT NULL;
