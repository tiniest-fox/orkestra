//! Record spawn failure in session and iteration.

use crate::workflow::domain::SessionState;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

/// Record spawn failure in iteration.
///
/// Sets the current iteration's outcome to `SpawnFailed` and transitions
/// session back to `Active` (ready for retry).
pub(crate) fn execute(
    store: &dyn WorkflowStore,
    task_id: &str,
    stage: &str,
    error: &str,
) -> WorkflowResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    // Update session state to Active (ready for retry)
    let mut session = store.get_stage_session(task_id, stage)?.ok_or_else(|| {
        WorkflowError::StageSessionNotFound(format!(
            "{task_id}/{stage} - on_spawn_starting must be called first"
        ))
    })?;

    session.session_state = SessionState::Active;
    session.updated_at.clone_from(&now);
    store.save_stage_session(&session)?;

    // Find and end the active iteration with SpawnFailed outcome
    if let Some(mut iteration) = store.get_active_iteration(task_id, stage)? {
        iteration.end(
            &now,
            Outcome::SpawnFailed {
                error: error.to_string(),
            },
        );
        store.save_iteration(&iteration)?;
    }

    Ok(())
}
