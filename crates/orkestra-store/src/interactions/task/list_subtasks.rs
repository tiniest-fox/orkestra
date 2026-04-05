//! List tasks by parent ID.

use orkestra_types::domain::Task;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, parent_id: &str) -> WorkflowResult<Vec<Task>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, state, artifacts,
                    parent_id, depends_on, branch_name, worktree_path,
                    auto_mode, created_at, updated_at, completed_at,
                    base_branch, flow, short_id, base_commit, pr_url, interactive,
                    resources
             FROM workflow_tasks WHERE parent_id = ? ORDER BY created_at",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![parent_id], super::from_row::execute)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(tasks)
}
