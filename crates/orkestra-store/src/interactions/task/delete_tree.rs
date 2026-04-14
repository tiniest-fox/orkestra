//! Delete an entire task tree atomically using a transaction.

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_ids: &[String]) -> WorkflowResult<()> {
    // unchecked_transaction takes &self (not &mut self), which is safe here
    // because the Mutex already guarantees exclusive access.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    // Delete in FK-safe order: log_entries reference sessions, iterations
    // reference sessions, sessions reference tasks, and child tasks reference parent tasks.
    for id in task_ids {
        tx.execute(
            "DELETE FROM log_entries WHERE stage_session_id IN (SELECT id FROM workflow_stage_sessions WHERE task_id = ?)",
            params![id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    }
    for id in task_ids {
        tx.execute(
            "DELETE FROM workflow_iterations WHERE task_id = ?",
            params![id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    }
    for id in task_ids {
        tx.execute(
            "DELETE FROM workflow_stage_sessions WHERE task_id = ?",
            params![id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    }
    for id in task_ids {
        tx.execute(
            "DELETE FROM workflow_artifacts WHERE task_id = ?",
            params![id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    }
    // Reverse order: children before parents (parent_id FK)
    for id in task_ids.iter().rev() {
        tx.execute("DELETE FROM workflow_tasks WHERE id = ?", params![id])
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    }
    tx.commit()
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
