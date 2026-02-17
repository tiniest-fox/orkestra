//! Supersede the active session for a stage.

use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Supersede the active session for a stage, forcing the next spawn to create
/// a fresh session. No-op if no active session exists.
pub(crate) fn execute(store: &dyn WorkflowStore, task_id: &str, stage: &str) -> WorkflowResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        session.supersede(&now);
        store.save_stage_session(&session)?;
    }
    Ok(())
}
