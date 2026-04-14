//! Get the most recent artifact for a task/stage/name combination.

use orkestra_types::domain::WorkflowArtifact;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(
    conn: &Connection,
    task_id: &str,
    stage: &str,
    name: &str,
) -> WorkflowResult<Option<WorkflowArtifact>> {
    conn.query_row(
        "SELECT id, task_id, iteration_id, stage, name, content, created_at
         FROM workflow_artifacts
         WHERE task_id = ? AND stage = ? AND name = ?
         ORDER BY created_at DESC
         LIMIT 1",
        params![task_id, stage, name],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
