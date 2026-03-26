//! List archived subtasks for multiple parent IDs in one query.

use orkestra_types::domain::Task;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, parent_ids: &[&str]) -> WorkflowResult<Vec<Task>> {
    if parent_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; parent_ids.len()].join(", ");
    let sql = format!(
        "SELECT id, title, description, state, artifacts,
                parent_id, depends_on, branch_name, worktree_path,
                auto_mode, created_at, updated_at, completed_at,
                base_branch, flow, short_id, base_commit, pr_url, interactive
         FROM workflow_tasks
         WHERE parent_id IN ({placeholders}) AND state LIKE '%archived%'
         ORDER BY created_at"
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(parent_ids.iter()),
            super::from_row::execute,
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(tasks)
}
