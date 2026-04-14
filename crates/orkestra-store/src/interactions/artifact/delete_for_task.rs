//! Delete all artifacts for a task.

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<()> {
    conn.execute(
        "DELETE FROM workflow_artifacts WHERE task_id = ?",
        params![task_id],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
