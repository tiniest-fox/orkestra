//! List iterations scoped to a set of task IDs using a single IN clause.

use orkestra_types::domain::Iteration;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_ids: &[&str]) -> WorkflowResult<Vec<Iteration>> {
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; task_ids.len()].join(", ");
    let sql = format!(
        "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered, activity_log, gate_result, artifact_snapshot
         FROM workflow_iterations WHERE task_id IN ({placeholders}) ORDER BY task_id, started_at, iteration_number"
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(task_ids.iter()),
            super::from_row::execute,
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut iterations = Vec::new();
    for row in rows {
        iterations.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(iterations)
}
