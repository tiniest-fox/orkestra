//! Query stage sessions and running agent processes.

use crate::workflow::domain::StageSession;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Get a specific stage session for a task.
pub fn get_stage_session(
    store: &dyn WorkflowStore,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<Option<StageSession>> {
    store.get_stage_session(task_id, stage)
}

/// Get all stage sessions for a task.
pub fn get_stage_sessions(
    store: &dyn WorkflowStore,
    task_id: &str,
) -> WorkflowResult<Vec<StageSession>> {
    store.get_stage_sessions(task_id)
}

/// Get all running agent processes as (`task_id`, stage, pid) tuples.
pub fn get_running_agent_pids(
    store: &dyn WorkflowStore,
) -> WorkflowResult<Vec<(String, String, u32)>> {
    let sessions = store.get_sessions_with_pids()?;
    Ok(sessions
        .into_iter()
        .filter_map(|s| s.agent_pid.map(|pid| (s.task_id, s.stage, pid)))
        .collect())
}
