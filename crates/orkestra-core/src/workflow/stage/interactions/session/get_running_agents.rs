//! Get all sessions with running agents.

use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Get all sessions with running agents.
///
/// Returns `(task_id, stage, pid)` tuples for sessions that have PIDs.
/// Used for orphan cleanup on startup.
pub(crate) fn execute(store: &dyn WorkflowStore) -> WorkflowResult<Vec<(String, String, u32)>> {
    let sessions = store.get_sessions_with_pids()?;
    Ok(sessions
        .into_iter()
        .filter_map(|s| s.agent_pid.map(|pid| (s.task_id, s.stage, pid)))
        .collect())
}
