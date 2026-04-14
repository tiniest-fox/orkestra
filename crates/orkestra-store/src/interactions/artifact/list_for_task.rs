//! List all artifacts for a task, ordered by creation time.

use orkestra_types::domain::WorkflowArtifact;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<Vec<WorkflowArtifact>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, iteration_id, stage, name, content, created_at
             FROM workflow_artifacts
             WHERE task_id = ?
             ORDER BY created_at",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![task_id], super::from_row::execute)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut artifacts = Vec::new();
    for row in rows {
        artifacts.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }
    Ok(artifacts)
}
