//! Update session after successful agent spawn.

use crate::orkestra_debug;
use crate::workflow::domain::SessionState;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

/// Update session after successful spawn.
///
/// Transitions session from `Spawning` to `Active`, records PID, and increments
/// `spawn_count` so that if the agent crashes, the next spawn uses `--resume`.
/// Also bumps the task's `updated_at` so differential sync reflects the state change.
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

    store.save_stage_session(&session)?;
    // Bump updated_at so differential sync picks up the Spawning→Active transition.
    store.touch_task(task_id)?;
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::domain::{SessionState, StageSession, Task};
    use std::sync::Arc;

    fn make_task(id: &str) -> Task {
        let mut task = Task::new(id, "Test", "Description", "work", "2020-01-01T00:00:00Z");
        task.updated_at = "2020-01-01T00:00:00Z".to_string();
        task
    }

    /// Agent spawn (Spawning → Active) must bump the task's `updated_at` so
    /// differential sync picks up the visible state change.
    #[test]
    fn on_agent_spawned_bumps_task_updated_at() {
        let store = Arc::new(InMemoryWorkflowStore::new());

        let task = make_task("task-1");
        store.save_task(&task).unwrap();

        // Create a session in Spawning state (normally done by on_spawn_starting)
        let now = chrono::Utc::now().to_rfc3339();
        let mut session = StageSession::new("session-1", "task-1", "work", &now);
        session.session_state = SessionState::Spawning;
        store.save_stage_session(&session).unwrap();

        let before = store.get_task("task-1").unwrap().unwrap().updated_at;

        // Brief sleep to ensure next timestamp is strictly greater
        std::thread::sleep(std::time::Duration::from_millis(5));

        execute(&*store, "task-1", "work", 12345).unwrap();

        let after = store.get_task("task-1").unwrap().unwrap().updated_at;
        assert_ne!(
            after, before,
            "on_agent_spawned must bump task updated_at so differential sync detects the state change"
        );

        // Confirm session state transition
        let saved_session = store.get_stage_session("task-1", "work").unwrap().unwrap();
        assert_eq!(saved_session.session_state, SessionState::Active);
        assert_eq!(saved_session.agent_pid, Some(12345));
    }
}
