//! Get a task by ID.

use orkestra_types::domain::Task;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, id: &str) -> WorkflowResult<Option<Task>> {
    conn.query_row(
        "SELECT id, title, description, state, artifacts,
                parent_id, depends_on, branch_name, worktree_path,
                auto_mode, created_at, updated_at, completed_at,
                base_branch, flow, short_id, base_commit, pr_url
         FROM workflow_tasks WHERE id = ?",
        params![id],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
