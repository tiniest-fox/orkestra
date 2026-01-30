-- Add base_branch column to track which branch a task was created from.
-- Used as the merge/rebase target during integration instead of always targeting main/master.
-- NULL for existing tasks (falls back to primary branch detection).
ALTER TABLE workflow_tasks ADD COLUMN base_branch TEXT;
