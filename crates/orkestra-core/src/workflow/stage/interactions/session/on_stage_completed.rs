//! Mark a stage session as completed.

use crate::orkestra_debug;
use crate::workflow::domain::SessionState;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Mark the stage session as completed.
///
/// Called when the stage is approved and we're moving to the next stage.
/// Completed sessions cannot be resumed.
pub(crate) fn execute(store: &dyn WorkflowStore, task_id: &str, stage: &str) -> WorkflowResult<()> {
    orkestra_debug!("session", "on_stage_completed {}/{}", task_id, stage);

    if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        session.session_state = SessionState::Completed;
        session.agent_pid = None;
        session.updated_at = chrono::Utc::now().to_rfc3339();
        store.save_stage_session(&session)?;
    }
    Ok(())
}
