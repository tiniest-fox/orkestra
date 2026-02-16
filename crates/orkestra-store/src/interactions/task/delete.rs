//! Delete a task by ID.

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, id: &str) -> WorkflowResult<()> {
    conn.execute("DELETE FROM workflow_tasks WHERE id = ?", params![id])
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
