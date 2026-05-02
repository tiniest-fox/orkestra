//! Deserialize a worktree record from a `SQLite` row.

use rusqlite::Row;

use crate::types::{WorktreeRecord, WorktreeStatus};

pub fn execute(row: &Row) -> rusqlite::Result<WorktreeRecord> {
    let status_str: String = row.get(1)?;
    Ok(WorktreeRecord {
        task_id: row.get(0)?,
        status: status_str.parse().unwrap_or(WorktreeStatus::Pending),
        base_branch: row.get(2)?,
        worktree_path: row.get(3)?,
        created_at: row.get(4)?,
    })
}
