//! Record that an agent process exited.

use crate::orkestra_debug;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Record that the agent process exited.
///
/// Clears the PID and keeps the session active for potential resume.
/// Note: `spawn_count` was already incremented at spawn time in `on_agent_spawned`.
pub(crate) fn execute(store: &dyn WorkflowStore, task_id: &str, stage: &str) -> WorkflowResult<()> {
    if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        let now = chrono::Utc::now().to_rfc3339();
        session.agent_finished(&now);

        orkestra_debug!(
            "session",
            "on_agent_exited {}/{}: spawn_count now {}, claude_session_id={:?}",
            task_id,
            stage,
            session.spawn_count,
            session.claude_session_id
        );

        store.save_stage_session(&session)?;
    }
    Ok(())
}
