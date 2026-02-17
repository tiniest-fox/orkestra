//! Update session after successful agent spawn.

use crate::orkestra_debug;
use crate::workflow::domain::SessionState;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

/// Update session after successful spawn.
///
/// Transitions session from `Spawning` to `Active`, records PID, and increments
/// `spawn_count` so that if the agent crashes, the next spawn uses `--resume`.
pub(crate) fn execute(
    store: &dyn WorkflowStore,
    task_id: &str,
    stage: &str,
    pid: u32,
) -> WorkflowResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    let mut session = store.get_stage_session(task_id, stage)?.ok_or_else(|| {
        WorkflowError::StageSessionNotFound(format!(
            "{task_id}/{stage} - on_spawn_starting must be called first"
        ))
    })?;

    session.session_state = SessionState::Active;
    session.agent_spawned(pid, &now);

    orkestra_debug!(
        "session",
        "on_agent_spawned {}/{}: pid={}, spawn_count={}, claude_session_id={:?}",
        task_id,
        stage,
        pid,
        session.spawn_count,
        session.claude_session_id
    );

    store.save_stage_session(&session)
}
