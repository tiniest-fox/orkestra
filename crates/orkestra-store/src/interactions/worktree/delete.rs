//! Delete a worktree record by `task_id`.

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<()> {
    conn.execute("DELETE FROM worktrees WHERE task_id = ?", params![task_id])
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
