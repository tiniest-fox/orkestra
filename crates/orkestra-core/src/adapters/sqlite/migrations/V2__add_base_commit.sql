-- Add base_commit column to workflow_tasks
ALTER TABLE workflow_tasks ADD COLUMN base_commit TEXT NOT NULL DEFAULT '';
