//! Convert a `SQLite` row to a `StageSession`.

use orkestra_types::domain::{StageSession, TokenUsage};

use crate::types::parse_session_state;

/// Convert a row to a `StageSession`.
///
/// Column order: id, `task_id`, stage, `claude_session_id`, `agent_pid`,
/// `spawn_count`, `session_state`, `created_at`, `updated_at`, `has_activity`,
/// `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
/// `cache_read_input_tokens`, `total_cost`
pub fn execute(row: &rusqlite::Row) -> rusqlite::Result<StageSession> {
    let agent_pid: Option<i32> = row.get(4)?;
    let spawn_count: i32 = row.get(5)?;
    let state_str: String = row.get(6)?;
    let has_activity: i32 = row.get(9)?;

    let input_tokens: Option<i64> = row.get(10)?;
    let output_tokens: Option<i64> = row.get(11)?;
    let cache_creation: Option<i64> = row.get(12)?;
    let cache_read: Option<i64> = row.get(13)?;
    let total_cost: Option<f64> = row.get(14)?;

    // Use AND to match the writer's invariant: all four columns are always written together.
    // A partial-NULL row (corruption/manual edit) is treated as absent rather than fabricating zeros.
    let token_usage = if input_tokens.is_some() && output_tokens.is_some() {
        Some(TokenUsage {
            input_tokens: u64::try_from(input_tokens.unwrap_or(0)).unwrap_or(0),
            output_tokens: u64::try_from(output_tokens.unwrap_or(0)).unwrap_or(0),
            cache_creation_input_tokens: u64::try_from(cache_creation.unwrap_or(0)).unwrap_or(0),
            cache_read_input_tokens: u64::try_from(cache_read.unwrap_or(0)).unwrap_or(0),
        })
    } else {
        None
    };

    // PIDs and spawn counts are never negative in SQLite; the i32→u32 cast is safe.
    #[allow(clippy::cast_sign_loss)]
    let agent_pid_u32 = agent_pid.map(|p| p as u32);
    #[allow(clippy::cast_sign_loss)]
    let spawn_count_u32 = spawn_count as u32;

    Ok(StageSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        stage: row.get(2)?,
        claude_session_id: row.get(3)?,
        agent_pid: agent_pid_u32,
        spawn_count: spawn_count_u32,
        has_activity: has_activity != 0,
        session_state: parse_session_state(&state_str),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        token_usage,
        total_cost,
    })
}
