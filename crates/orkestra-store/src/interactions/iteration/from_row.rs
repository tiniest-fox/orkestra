//! Convert a `SQLite` row to an `Iteration`.

use orkestra_types::domain::Iteration;

/// Convert a row to an `Iteration`.
///
/// Column order: id, `task_id`, stage, `iteration_number`, `started_at`,
/// `ended_at`, outcome, `stage_session_id`, `incoming_context`,
/// `trigger_delivered`, `activity_log`, `gate_result`
#[allow(clippy::cast_sign_loss)]
pub fn execute(row: &rusqlite::Row) -> rusqlite::Result<Iteration> {
    let iteration_number: i32 = row.get(3)?;
    let outcome_json: Option<String> = row.get(6)?;

    // Column 8 is incoming_context (added in V9 migration)
    let incoming_context_json: Option<String> = row.get(8).unwrap_or(None);

    // Column 9 is trigger_delivered (in initial schema V1)
    let trigger_delivered: bool = row.get(9).unwrap_or(false);

    // Column 10 is activity_log (added in V6 migration)
    let activity_log: Option<String> = row.get(10).unwrap_or(None);

    // Column 11 is gate_result (added in V10 migration)
    let gate_result_json: Option<String> = row.get(11).unwrap_or(None);

    Ok(Iteration {
        id: row.get(0)?,
        task_id: row.get(1)?,
        stage: row.get(2)?,
        iteration_number: iteration_number as u32,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        outcome: outcome_json.and_then(|j| serde_json::from_str(&j).ok()),
        stage_session_id: row.get(7)?,
        incoming_context: incoming_context_json.and_then(|j| serde_json::from_str(&j).ok()),
        trigger_delivered,
        activity_log,
        gate_result: gate_result_json.and_then(|j| serde_json::from_str(&j).ok()),
    })
}
