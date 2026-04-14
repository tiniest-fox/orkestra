//! Save a workflow artifact (insert or replace by ID).

use orkestra_types::domain::WorkflowArtifact;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, artifact: &WorkflowArtifact) -> WorkflowResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO workflow_artifacts (id, task_id, iteration_id, stage, name, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            artifact.id,
            artifact.task_id,
            artifact.iteration_id,
            artifact.stage,
            artifact.name,
            artifact.content,
            artifact.created_at,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
