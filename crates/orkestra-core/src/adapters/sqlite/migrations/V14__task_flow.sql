-- Add flow field to workflow_tasks for alternate workflow flows.
-- NULL means default flow (full pipeline).
ALTER TABLE workflow_tasks ADD COLUMN flow TEXT DEFAULT NULL;
