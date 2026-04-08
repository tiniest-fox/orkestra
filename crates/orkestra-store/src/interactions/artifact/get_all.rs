//! Get all artifacts for a task.

use orkestra_types::runtime::Artifact;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

use super::get::from_row;

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<Vec<Artifact>> {
    let mut stmt = conn
        .prepare(
            "SELECT name, content, html, stage, iteration, created_at
             FROM workflow_artifacts
             WHERE task_id = ?
             ORDER BY name ASC",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![task_id], from_row)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| WorkflowError::Storage(e.to_string()))
}
