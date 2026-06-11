ALTER TABLE workflow_tasks ADD COLUMN auto_resolve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_tasks ADD COLUMN auto_resolve_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_tasks ADD COLUMN resolved_feedback_ids TEXT NOT NULL DEFAULT '{}';
