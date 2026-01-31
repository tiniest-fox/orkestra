-- Track whether an iteration's incoming trigger has been delivered to the agent.
-- Once delivered, crash recovery uses "session interrupted" instead of replaying
-- the original trigger (e.g., script failure details the agent already received).
-- Defaults to FALSE (not yet delivered).

ALTER TABLE workflow_iterations ADD COLUMN trigger_delivered INTEGER NOT NULL DEFAULT 0;
