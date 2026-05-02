//! Generate the next unique task ID using petnames.

use petname::Generator;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection) -> WorkflowResult<String> {
    let petname_gen = petname::Petnames::default();

    for _ in 0..100 {
        let Some(id) = petname_gen.generate_one(3, "-") else {
            continue;
        };

        let exists_task: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM workflow_tasks WHERE id = ?)",
                params![&id],
                |row| row.get(0),
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let exists_worktree: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM worktrees WHERE task_id = ?)",
                params![&id],
                |row| row.get(0),
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        if !exists_task && !exists_worktree {
            return Ok(id);
        }
    }

    Err(WorkflowError::Storage(
        "Failed to generate unique task ID after 100 attempts".into(),
    ))
}
