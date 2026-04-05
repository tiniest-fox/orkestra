//! Save a task (insert or update).

use orkestra_types::domain::Task;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task: &Task) -> WorkflowResult<()> {
    let state_json =
        serde_json::to_string(&task.state).map_err(|e| WorkflowError::Storage(e.to_string()))?;
    let artifacts_json = serde_json::to_string(&task.artifacts)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    let resources_json = serde_json::to_string(&task.resources)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    let depends_json = serde_json::to_string(&task.depends_on)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    conn.execute(
        "INSERT OR REPLACE INTO workflow_tasks (
            id, title, description, state, artifacts,
            parent_id, depends_on, branch_name, worktree_path,
            auto_mode, created_at, updated_at, completed_at,
            base_branch, flow, short_id, base_commit, pr_url, interactive,
            resources
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            task.id,
            task.title,
            task.description,
            state_json,
            artifacts_json,
            task.parent_id,
            depends_json,
            task.branch_name,
            task.worktree_path,
            task.auto_mode,
            task.created_at,
            task.updated_at,
            task.completed_at,
            task.base_branch,
            task.flow,
            task.short_id,
            task.base_commit,
            task.pr_url,
            task.created_interactive,
            resources_json,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    Ok(())
}
