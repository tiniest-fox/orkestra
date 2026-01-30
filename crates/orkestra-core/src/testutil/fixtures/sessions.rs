//! Stage session fixture factories.

use crate::workflow::domain::StageSession;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

use super::FIXTURE_TIMESTAMP;

/// Save an active session for a task/stage.
pub fn save_session(
    store: &dyn WorkflowStore,
    id: &str,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<StageSession> {
    let session = StageSession::new(id, task_id, stage, FIXTURE_TIMESTAMP);
    store.save_stage_session(&session)?;
    Ok(session)
}

/// Save a session with a recorded agent PID (simulates a spawned agent).
pub fn save_session_with_pid(
    store: &dyn WorkflowStore,
    id: &str,
    task_id: &str,
    stage: &str,
    pid: u32,
) -> WorkflowResult<StageSession> {
    let mut session = StageSession::new(id, task_id, stage, FIXTURE_TIMESTAMP);
    session.agent_spawned(pid, FIXTURE_TIMESTAMP);
    store.save_stage_session(&session)?;
    Ok(session)
}

/// Save a completed session.
pub fn save_completed_session(
    store: &dyn WorkflowStore,
    id: &str,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<StageSession> {
    let mut session = StageSession::new(id, task_id, stage, FIXTURE_TIMESTAMP);
    session.complete(FIXTURE_TIMESTAMP);
    store.save_stage_session(&session)?;
    Ok(session)
}
