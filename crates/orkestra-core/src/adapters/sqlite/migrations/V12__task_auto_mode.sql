-- Add auto_mode flag to workflow tasks for autonomous execution.
ALTER TABLE workflow_tasks ADD COLUMN auto_mode INTEGER NOT NULL DEFAULT 0;
