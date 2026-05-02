//! Get a worktree record by `task_id`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};
use crate::types::WorktreeRecord;

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<Option<WorktreeRecord>> {
    conn.query_row(
        "SELECT task_id, status, base_branch, worktree_path, created_at
         FROM worktrees WHERE task_id = ?",
        params![task_id],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
