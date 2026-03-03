//! Convert a `SQLite` row to a `StageSession`.

use orkestra_types::domain::StageSession;

use crate::types::parse_session_state;

/// Convert a row to a `StageSession`.
///
/// Column order: id, `task_id`, stage, `claude_session_id`, `agent_pid`,
/// `spawn_count`, `session_state`, `created_at`, `updated_at`, `has_activity`, `chat_active`
#[allow(clippy::cast_sign_loss)]
pub fn execute(row: &rusqlite::Row) -> rusqlite::Result<StageSession> {
    let agent_pid: Option<i32> = row.get(4)?;
    let spawn_count: i32 = row.get(5)?;
    let state_str: String = row.get(6)?;
    let has_activity: i32 = row.get(9)?;
    let chat_active: i32 = row.get(10)?;

    Ok(StageSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        stage: row.get(2)?,
        claude_session_id: row.get(3)?,
        agent_pid: agent_pid.map(|p| p as u32),
        spawn_count: spawn_count as u32,
        has_activity: has_activity != 0,
        chat_active: chat_active != 0,
        session_state: parse_session_state(&state_str),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
