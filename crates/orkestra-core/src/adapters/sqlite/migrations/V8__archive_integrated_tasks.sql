-- Migrate already-integrated Done tasks to Archived.
--
-- In the old integration system, worktree_path was cleared when a task was integrated.
-- Done tasks with NULL worktree_path are already integrated and should become Archived.
-- Done tasks with non-NULL worktree_path are ready for integration but not yet integrated.

UPDATE workflow_tasks
SET status = '{"type":"archived"}'
WHERE status = '{"type":"done"}'
  AND worktree_path IS NULL;
