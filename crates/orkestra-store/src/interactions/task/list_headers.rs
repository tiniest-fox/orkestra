//! List all tasks as lightweight headers (no artifact deserialization).

use orkestra_types::domain::TaskHeader;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection) -> WorkflowResult<Vec<TaskHeader>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, state,
                    parent_id, depends_on, branch_name, worktree_path,
                    auto_mode, created_at, updated_at, completed_at,
                    base_branch, flow, short_id, base_commit, pr_url
             FROM workflow_tasks ORDER BY created_at",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map([], super::from_row::execute_header)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut headers = Vec::new();
    for row in rows {
        headers.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(headers)
}
