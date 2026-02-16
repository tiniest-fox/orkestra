//! Save an iteration (insert or update by ID).

use orkestra_types::domain::Iteration;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

#[allow(clippy::cast_possible_wrap)]
pub fn execute(conn: &Connection, iteration: &Iteration) -> WorkflowResult<()> {
    let outcome_json = iteration
        .outcome
        .as_ref()
        .map(|o| serde_json::to_string(o).map_err(|e| WorkflowError::Storage(e.to_string())))
        .transpose()?;

    let incoming_context_json = iteration
        .incoming_context
        .as_ref()
        .map(|c| serde_json::to_string(c).map_err(|e| WorkflowError::Storage(e.to_string())))
        .transpose()?;

    conn.execute(
        "INSERT OR REPLACE INTO workflow_iterations (
            id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered, activity_log
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            iteration.id,
            iteration.task_id,
            iteration.stage,
            iteration.iteration_number as i32,
            iteration.started_at,
            iteration.ended_at,
            outcome_json,
            iteration.stage_session_id,
            incoming_context_json,
            iteration.trigger_delivered,
            iteration.activity_log,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    Ok(())
}
