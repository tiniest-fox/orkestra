//! Update a task's title without modifying other fields.

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, id: &str, title: &str) -> WorkflowResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn
        .execute(
            "UPDATE workflow_tasks SET title = ?, updated_at = ? WHERE id = ?",
            params![title, now, id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    if rows == 0 {
        return Err(WorkflowError::TaskNotFound(id.to_string()));
    }
    Ok(())
}
