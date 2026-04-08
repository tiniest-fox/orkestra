//! Save an artifact for a task (insert or replace by `task_id` + name).

use orkestra_types::runtime::Artifact;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

#[allow(clippy::cast_possible_wrap)]
pub fn execute(conn: &Connection, task_id: &str, artifact: &Artifact) -> WorkflowResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO workflow_artifacts (task_id, name, content, html, stage, iteration, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            task_id,
            artifact.name,
            artifact.content,
            artifact.html,
            artifact.stage,
            i64::from(artifact.iteration),
            artifact.created_at,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
