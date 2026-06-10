//! Save a worktree record (insert or replace by `task_id`).

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};
use crate::types::WorktreeRecord;

pub fn execute(conn: &Connection, record: &WorktreeRecord) -> WorkflowResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO worktrees (task_id, status, base_branch, worktree_path, branch_name, base_commit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            record.task_id,
            record.status.to_string(),
            record.base_branch,
            record.worktree_path,
            record.branch_name,
            record.base_commit,
            record.created_at,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
