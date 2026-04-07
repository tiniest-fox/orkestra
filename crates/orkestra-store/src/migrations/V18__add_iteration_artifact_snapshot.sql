ALTER TABLE workflow_iterations ADD COLUMN artifact_snapshot TEXT;
ALTER TABLE log_entries ADD COLUMN iteration_id TEXT;
