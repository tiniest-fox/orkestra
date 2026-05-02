//! List all worktree records.

use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};
use crate::types::WorktreeRecord;

pub fn execute(conn: &Connection) -> WorkflowResult<Vec<WorktreeRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT task_id, status, base_branch, worktree_path, created_at
             FROM worktrees ORDER BY created_at ASC",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let records = stmt
        .query_map([], super::from_row::execute)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    Ok(records)
}
