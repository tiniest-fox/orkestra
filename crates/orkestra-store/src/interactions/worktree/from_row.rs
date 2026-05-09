//! Deserialize a worktree record from a `SQLite` row.

use rusqlite::Row;

use crate::types::{WorktreeRecord, WorktreeStatus};

pub fn execute(row: &Row) -> rusqlite::Result<WorktreeRecord> {
    let status_str: String = row.get(1)?;
    let status = status_str.parse::<WorktreeStatus>().map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        )
    })?;
    Ok(WorktreeRecord {
        task_id: row.get(0)?,
        status,
        base_branch: row.get(2)?,
        worktree_path: row.get(3)?,
        created_at: row.get(4)?,
        branch_name: row.get(5)?,
        base_commit: row.get(6)?,
    })
}
