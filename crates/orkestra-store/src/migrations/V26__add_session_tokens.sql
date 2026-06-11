ALTER TABLE workflow_stage_sessions ADD COLUMN input_tokens INTEGER;
ALTER TABLE workflow_stage_sessions ADD COLUMN output_tokens INTEGER;
ALTER TABLE workflow_stage_sessions ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE workflow_stage_sessions ADD COLUMN cache_read_input_tokens INTEGER;
ALTER TABLE workflow_stage_sessions ADD COLUMN total_cost REAL;
