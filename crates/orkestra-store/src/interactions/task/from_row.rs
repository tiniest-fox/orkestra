//! Convert a `SQLite` row to a `Task` or `TaskHeader`.

use orkestra_types::domain::{Task, TaskHeader};
use orkestra_types::runtime::Status;

use crate::types::parse_phase;

/// Convert a full task row (19 columns) to a `Task`.
///
/// Column order: id, title, description, status, phase, artifacts,
/// `parent_id`, `depends_on`, `branch_name`, `worktree_path`, `auto_mode`,
/// `created_at`, `updated_at`, `completed_at`, `base_branch`, flow, `short_id`,
/// `base_commit`, `pr_url`
pub fn execute(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    let status_json: String = row.get(3)?;
    let phase_str: String = row.get(4)?;
    let artifacts_json: String = row.get(5)?;
    let depends_json: String = row.get(7)?;
    let auto_mode: bool = row.get::<_, i32>(10).unwrap_or(0) != 0;
    let flow: Option<String> = row.get(15).unwrap_or(None);
    let pr_url: Option<String> = row.get(18).unwrap_or(None);

    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: serde_json::from_str(&status_json).unwrap_or(Status::active("unknown")),
        phase: parse_phase(&phase_str)?,
        artifacts: serde_json::from_str(&artifacts_json).unwrap_or_default(),
        parent_id: row.get(6)?,
        short_id: row.get(16)?,
        depends_on: serde_json::from_str(&depends_json).unwrap_or_default(),
        branch_name: row.get(8)?,
        worktree_path: row.get(9)?,
        base_branch: row.get(14)?,
        base_commit: row.get(17)?,
        pr_url,
        auto_mode,
        flow,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        completed_at: row.get(13)?,
    })
}

/// Convert a header row (18 columns, no artifacts) to a `TaskHeader`.
///
/// Column order: id, title, description, status, phase,
/// `parent_id`, `depends_on`, `branch_name`, `worktree_path`,
/// `auto_mode`, `created_at`, `updated_at`, `completed_at`,
/// `base_branch`, flow, `short_id`, `base_commit`, `pr_url`
pub fn execute_header(row: &rusqlite::Row) -> rusqlite::Result<TaskHeader> {
    let status_json: String = row.get(3)?;
    let phase_str: String = row.get(4)?;
    let depends_json: String = row.get(6)?;
    let auto_mode: bool = row.get::<_, i32>(9).unwrap_or(0) != 0;
    let flow: Option<String> = row.get(14).unwrap_or(None);
    let pr_url: Option<String> = row.get(17).unwrap_or(None);

    Ok(TaskHeader {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: serde_json::from_str(&status_json).unwrap_or(Status::active("unknown")),
        phase: parse_phase(&phase_str)?,
        parent_id: row.get(5)?,
        short_id: row.get(15)?,
        depends_on: serde_json::from_str(&depends_json).unwrap_or_default(),
        branch_name: row.get(7)?,
        worktree_path: row.get(8)?,
        base_branch: row.get(13)?,
        base_commit: row.get(16)?,
        pr_url,
        auto_mode,
        flow,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}
