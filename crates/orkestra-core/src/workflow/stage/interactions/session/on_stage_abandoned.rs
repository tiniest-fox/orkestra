//! Mark a stage session as abandoned.

use crate::orkestra_debug;
use crate::workflow::domain::SessionState;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Mark the stage session as abandoned.
///
/// Called when the task fails, is blocked, or the stage is rejected.
/// Abandoned sessions cannot be resumed.
pub(crate) fn execute(store: &dyn WorkflowStore, task_id: &str, stage: &str) -> WorkflowResult<()> {
    orkestra_debug!("session", "on_stage_abandoned {}/{}", task_id, stage);

    if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        session.session_state = SessionState::Abandoned;
        session.agent_pid = None;
        session.updated_at = chrono::Utc::now().to_rfc3339();
        store.save_stage_session(&session)?;
    }
    Ok(())
}
