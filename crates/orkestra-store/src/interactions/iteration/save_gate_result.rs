//! Update the `gate_result` column on an iteration (targeted UPDATE).

use orkestra_types::domain::GateResult;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

/// Update only the `gate_result` column for an iteration.
///
/// Avoids re-serializing the full iteration on every poll tick.
pub fn execute(
    conn: &Connection,
    iteration_id: &str,
    gate_result: &GateResult,
) -> WorkflowResult<()> {
    let json =
        serde_json::to_string(gate_result).map_err(|e| WorkflowError::Storage(e.to_string()))?;
    let count = conn
        .execute(
            "UPDATE workflow_iterations SET gate_result = ? WHERE id = ?",
            params![json, iteration_id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    if count == 0 {
        return Err(WorkflowError::IterationNotFound(iteration_id.to_string()));
    }
    Ok(())
}
