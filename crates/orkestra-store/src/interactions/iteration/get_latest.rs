//! Get the latest iteration for a task in a stage (regardless of status).

use orkestra_types::domain::Iteration;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str, stage: &str) -> WorkflowResult<Option<Iteration>> {
    conn.query_row(
        "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered, activity_log, gate_result, artifact_snapshot
         FROM workflow_iterations
         WHERE task_id = ? AND stage = ?
         ORDER BY iteration_number DESC LIMIT 1",
        params![task_id, stage],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
