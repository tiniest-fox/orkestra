//! Convert a `SQLite` row to a `Task` or `TaskHeader`.

use orkestra_types::domain::{Task, TaskHeader};
use orkestra_types::runtime::TaskState;

/// Convert a full task row (21 columns) to a `Task`.
///
/// Column order: id, title, description, state, artifacts,
/// `parent_id`, `depends_on`, `branch_name`, `worktree_path`, `auto_mode`,
/// `created_at`, `updated_at`, `completed_at`, `base_branch`, flow, `short_id`,
/// `base_commit`, `pr_url`, interactive, resources, `is_chat`
pub fn execute(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    let state_json: String = row.get(3)?;
    let artifacts_json: String = row.get(4)?;
    let depends_json: String = row.get(6)?;
    let auto_mode: bool = row.get::<_, i32>(9).unwrap_or(0) != 0;
    let flow: String = row
        .get::<_, Option<String>>(14)?
        .unwrap_or_else(|| "default".to_string());
    let pr_url: Option<String> = row.get(17).unwrap_or(None);
    let resources_json: String = row.get(19)?;
    let is_chat: bool = row.get::<_, i32>(20).unwrap_or(0) != 0;

    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        state: serde_json::from_str(&state_json).unwrap_or(TaskState::queued("unknown")),
        artifacts: serde_json::from_str(&artifacts_json).unwrap_or_default(),
        resources: serde_json::from_str(&resources_json).unwrap_or_default(),
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
        is_chat,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}

/// Convert a header row (19 columns, no artifacts/resources) to a `TaskHeader`.
///
/// Column order: id, title, description, state,
/// `parent_id`, `depends_on`, `branch_name`, `worktree_path`,
/// `auto_mode`, `created_at`, `updated_at`, `completed_at`,
/// `base_branch`, flow, `short_id`, `base_commit`, `pr_url`, interactive, `is_chat`
pub fn execute_header(row: &rusqlite::Row) -> rusqlite::Result<TaskHeader> {
    let state_json: String = row.get(3)?;
    let depends_json: String = row.get(5)?;
    let auto_mode: bool = row.get::<_, i32>(8).unwrap_or(0) != 0;
    let flow: String = row
        .get::<_, Option<String>>(13)?
        .unwrap_or_else(|| "default".to_string());
    let pr_url: Option<String> = row.get(16).unwrap_or(None);
    let is_chat: bool = row.get::<_, i32>(18).unwrap_or(0) != 0;

    Ok(TaskHeader {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        state: serde_json::from_str(&state_json).unwrap_or(TaskState::queued("unknown")),
        parent_id: row.get(4)?,
        short_id: row.get(14)?,
        depends_on: serde_json::from_str(&depends_json).unwrap_or_default(),
        branch_name: row.get(6)?,
        worktree_path: row.get(7)?,
        base_branch: row.get(12)?,
        base_commit: row.get(15)?,
        pr_url,
        auto_mode,
        flow,
        is_chat,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        completed_at: row.get(11)?,
    })
}
