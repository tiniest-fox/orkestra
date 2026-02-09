-- Backfill: assume all pre-existing sessions had activity
UPDATE workflow_stage_sessions SET has_activity = 1;
