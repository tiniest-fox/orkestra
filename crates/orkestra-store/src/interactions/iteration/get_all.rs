//! Get all iterations for a task.

use orkestra_types::domain::Iteration;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered, activity_log, gate_result, artifact_snapshot
             FROM workflow_iterations WHERE task_id = ? ORDER BY started_at, iteration_number",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![task_id], super::from_row::execute)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut iterations = Vec::new();
    for row in rows {
        iterations.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(iterations)
}
