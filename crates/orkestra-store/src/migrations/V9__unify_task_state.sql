-- Unify status + phase into a single state column (JSON).
-- Old status and phase columns are dropped after data migration.

ALTER TABLE workflow_tasks ADD COLUMN state TEXT NOT NULL DEFAULT '{"type":"queued","stage":"unknown"}';

UPDATE workflow_tasks SET state = CASE
    WHEN json_extract(status, '$.type') = 'archived' THEN '{"type":"archived"}'
    WHEN json_extract(status, '$.type') = 'failed' THEN
        json_object('type', 'failed', 'error', json_extract(status, '$.error'))
    WHEN json_extract(status, '$.type') = 'blocked' THEN
        json_object('type', 'blocked', 'reason', json_extract(status, '$.reason'))
    WHEN json_extract(status, '$.type') = 'done' AND phase = 'integrating' THEN '{"type":"integrating"}'
    WHEN json_extract(status, '$.type') = 'done' THEN '{"type":"done"}'
    WHEN json_extract(status, '$.type') = 'waiting_on_children' THEN
        json_object('type', 'waiting_on_children', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'awaiting_setup' THEN
        json_object('type', 'awaiting_setup', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'setting_up' THEN
        json_object('type', 'setting_up', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'agent_working' THEN
        json_object('type', 'agent_working', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'awaiting_review' THEN
        json_object('type', 'awaiting_approval', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'interrupted' THEN
        json_object('type', 'interrupted', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'finishing' THEN
        json_object('type', 'finishing', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'committing' THEN
        json_object('type', 'committing', 'stage', json_extract(status, '$.stage'))
    WHEN phase = 'integrating' THEN '{"type":"integrating"}'
    ELSE json_object('type', 'queued', 'stage',
        COALESCE(json_extract(status, '$.stage'), 'unknown'))
END;

-- Drop indexes on old columns, then drop the old columns.
DROP INDEX IF EXISTS idx_workflow_tasks_status;
DROP INDEX IF EXISTS idx_workflow_tasks_phase;
ALTER TABLE workflow_tasks DROP COLUMN status;
ALTER TABLE workflow_tasks DROP COLUMN phase;
