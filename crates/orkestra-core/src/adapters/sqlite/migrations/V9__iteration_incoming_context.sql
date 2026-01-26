-- Add incoming_context column to workflow_iterations table.
-- This stores why an iteration was created (feedback, answers, integration error, etc.)
-- as JSON. NULL means first iteration of a stage (no special context).

ALTER TABLE workflow_iterations ADD COLUMN incoming_context TEXT;
