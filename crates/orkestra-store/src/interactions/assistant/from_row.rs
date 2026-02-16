//! Convert a `SQLite` row to an `AssistantSession`.

use orkestra_types::domain::AssistantSession;

use crate::types::parse_session_state;

/// Convert a row to an `AssistantSession`.
///
/// Column order: id, `claude_session_id`, title, `agent_pid`,
/// `spawn_count`, `session_state`, `created_at`, `updated_at`
#[allow(clippy::cast_sign_loss)]
pub fn execute(row: &rusqlite::Row) -> rusqlite::Result<AssistantSession> {
    let agent_pid: Option<i32> = row.get(3)?;
    let spawn_count: i32 = row.get(4)?;
    let state_str: String = row.get(5)?;

    Ok(AssistantSession {
        id: row.get(0)?,
        claude_session_id: row.get(1)?,
        title: row.get(2)?,
        agent_pid: agent_pid.map(|p| p as u32),
        spawn_count: spawn_count as u32,
        session_state: parse_session_state(&state_str),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}
