CREATE TABLE workflow_artifacts (
    task_id  TEXT    NOT NULL REFERENCES workflow_tasks(id),
    name     TEXT    NOT NULL,
    content  TEXT    NOT NULL,
    html     TEXT,
    stage    TEXT    NOT NULL,
    iteration INTEGER NOT NULL DEFAULT 1,
    created_at TEXT  NOT NULL,
    PRIMARY KEY (task_id, name)
);

CREATE INDEX idx_workflow_artifacts_task ON workflow_artifacts(task_id);
