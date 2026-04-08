//! Get a single artifact by task ID and name.

use orkestra_types::runtime::Artifact;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str, name: &str) -> WorkflowResult<Option<Artifact>> {
    let mut stmt = conn
        .prepare(
            "SELECT name, content, html, stage, iteration, created_at
             FROM workflow_artifacts
             WHERE task_id = ? AND name = ?",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let result = stmt
        .query_row(params![task_id, name], from_row)
        .optional()
        .map_err(|e: rusqlite::Error| WorkflowError::Storage(e.to_string()))?;

    Ok(result)
}

// -- Helpers --

pub(super) fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Artifact> {
    let iteration: i64 = row.get(4)?;
    Ok(Artifact {
        name: row.get(0)?,
        content: row.get(1)?,
        html: row.get(2)?,
        stage: row.get(3)?,
        iteration: u32::try_from(iteration).unwrap_or(1),
        created_at: row.get(5)?,
    })
}
