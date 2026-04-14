CREATE TABLE workflow_artifacts (
    id TEXT NOT NULL PRIMARY KEY,
    task_id TEXT NOT NULL,
    iteration_id TEXT,
    stage TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_workflow_artifacts_task_id ON workflow_artifacts (task_id);
CREATE INDEX idx_workflow_artifacts_task_stage_name ON workflow_artifacts (task_id, stage, name);
