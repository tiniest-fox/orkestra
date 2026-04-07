//! Get iterations for a task filtered by stage.

use orkestra_types::domain::Iteration;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str, stage: &str) -> WorkflowResult<Vec<Iteration>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered, activity_log, gate_result, artifact_snapshot
             FROM workflow_iterations WHERE task_id = ? AND stage = ? ORDER BY iteration_number",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![task_id, stage], super::from_row::execute)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut iterations = Vec::new();
    for row in rows {
        iterations.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(iterations)
}
