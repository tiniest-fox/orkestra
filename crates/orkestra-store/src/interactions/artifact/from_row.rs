//! Convert a `SQLite` row to a `WorkflowArtifact`.

use orkestra_types::domain::WorkflowArtifact;

/// Convert a row to a `WorkflowArtifact`.
///
/// Column order: id, `task_id`, `iteration_id`, stage, name, content, `created_at`
pub fn execute(row: &rusqlite::Row) -> rusqlite::Result<WorkflowArtifact> {
    Ok(WorkflowArtifact {
        id: row.get(0)?,
        task_id: row.get(1)?,
        iteration_id: row.get(2)?,
        stage: row.get(3)?,
        name: row.get(4)?,
        content: row.get(5)?,
        created_at: row.get(6)?,
    })
}
