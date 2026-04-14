//! Get a workflow artifact by ID.

use orkestra_types::domain::WorkflowArtifact;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, id: &str) -> WorkflowResult<Option<WorkflowArtifact>> {
    conn.query_row(
        "SELECT id, task_id, iteration_id, stage, name, content, created_at
         FROM workflow_artifacts WHERE id = ?",
        params![id],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
