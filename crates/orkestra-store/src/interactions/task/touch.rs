//! Bump the `updated_at` timestamp on a task without modifying other fields.

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, id: &str) -> WorkflowResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workflow_tasks SET updated_at = ? WHERE id = ?",
        params![now, id],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
