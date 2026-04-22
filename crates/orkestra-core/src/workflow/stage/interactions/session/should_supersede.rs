//! Decide whether to supersede the existing stage session before spawning.

use crate::workflow::domain::IterationTrigger;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Determine whether to supersede the existing stage session before spawning.
///
/// ## Supersession Rules
///
/// | Trigger           | Condition                   | Supersede? | Net result                                   |
/// |-------------------|-----------------------------|------------|----------------------------------------------|
/// | `Rejection`       | —                           | Yes        | Fresh session                                |
/// | `Integration`     | —                           | Yes        | Fresh session                                |
/// | `PrFeedback`      | —                           | Yes        | Fresh session (stale after Done)             |
/// | `Redirect`        | —                           | Yes        | Fresh session                                |
/// | `Restart`         | —                           | Yes        | Fresh session                                |
/// | `UserMessage`     | —                           | No         | Resume                                       |
/// | `GateFailure`     | —                           | No         | Resume (agent retries in same session)       |
/// | `Answers`         | —                           | No         | Resume                                       |
/// | `MalformedOutput` | —                           | No         | Resume                                       |
/// | `Interrupted`     | —                           | No         | Resume                                       |
/// | `None`            | `spawn_count == 0`                                                         | No  | First spawn — no prior session context     |
/// | `None`            | `spawn_count > 0`, active iter has `stage_session_id IS NOT NULL`          | No  | Crash recovery — resume existing session   |
/// | `None`            | `spawn_count > 0`, active iter has `stage_session_id IS NULL` or no iter  | Yes | Clean re-entry — fresh session             |
///
/// The distinguishing signal for the `None` trigger is `stage_session_id` on the active
/// iteration. `finalize_advancement` pre-creates the next stage's iteration with
/// `stage_session_id = None` before the spawn; `on_spawn_starting` sets it when the agent
/// actually runs. So a crash-recovery iteration (agent was mid-run) has
/// `stage_session_id IS NOT NULL`, while a clean re-entry iteration (pre-created, agent
/// hasn't run yet) has `stage_session_id IS NULL`.
pub fn execute(
    store: &dyn WorkflowStore,
    trigger: Option<&IterationTrigger>,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<bool> {
    if matches!(
        trigger,
        Some(
            IterationTrigger::Rejection { .. }
                | IterationTrigger::Integration { .. }
                | IterationTrigger::PrFeedback { .. }
                | IterationTrigger::Redirect { .. }
                | IterationTrigger::Restart { .. }
        )
    ) {
        return Ok(true);
    }

    // No trigger: distinguish crash recovery from clean re-entry.
    // `finalize_advancement` pre-creates the next stage's iteration with
    // `stage_session_id = None` before the spawn. `on_spawn_starting` then links
    // the iteration to the session by setting `stage_session_id`.
    // - Crash recovery: active iteration has `stage_session_id IS NOT NULL` → don't supersede
    // - Clean re-entry: active iteration has `stage_session_id IS NULL` (pre-created) → supersede
    if trigger.is_none() {
        if let Some(session) = store.get_stage_session(task_id, stage)? {
            if session.spawn_count > 0 {
                let is_crash_recovery = store
                    .get_active_iteration(task_id, stage)?
                    .map(|i| i.stage_session_id.is_some())
                    .unwrap_or(false);
                return Ok(!is_crash_recovery);
            }
        }
    }

    Ok(false)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::domain::{Iteration, StageSession, Task};
    use orkestra_types::runtime::Outcome;
    use std::sync::Arc;

    fn make_store_with_session(spawn_count: u32) -> Arc<InMemoryWorkflowStore> {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let task = Task::new("task-1", "Test", "Desc", "work", "2020-01-01T00:00:00Z");
        store.save_task(&task).unwrap();
        let mut session = StageSession::new("session-1", "task-1", "work", "2020-01-01T00:00:00Z");
        for _ in 0..spawn_count {
            session.agent_spawned(0, "2020-01-01T00:00:00Z");
        }
        store.save_stage_session(&session).unwrap();
        store
    }

    // -- Triggers that always supersede --

    #[test]
    fn test_supersede_rejection_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::Rejection {
            from_stage: "review".to_string(),
            feedback: "needs work".to_string(),
        };
        assert!(
            execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "Rejection trigger must supersede the session"
        );
    }

    #[test]
    fn test_supersede_integration_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::Integration {
            message: "merge conflict".to_string(),
            conflict_files: vec!["src/main.rs".to_string()],
        };
        assert!(
            execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "Integration trigger must supersede the session"
        );
    }

    #[test]
    fn test_supersede_restart_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::Restart {
            message: "redo this stage".to_string(),
        };
        assert!(
            execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "Restart trigger must supersede the session"
        );
    }

    #[test]
    fn test_supersede_pr_feedback_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::PrFeedback {
            comments: vec![],
            checks: vec![],
            guidance: Some("Please fix".to_string()),
        };
        assert!(
            execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "PrFeedback trigger must supersede — session context is stale after Done"
        );
    }

    #[test]
    fn test_supersede_redirect_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::Redirect {
            from_stage: "review".to_string(),
            message: "back to work".to_string(),
        };
        assert!(
            execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "Redirect trigger must supersede the session"
        );
    }

    // -- Triggers that never supersede --

    #[test]
    fn test_no_supersede_user_message_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::UserMessage {
            message: "please revise".to_string(),
        };
        assert!(
            !execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "UserMessage trigger must NOT supersede — resume the existing session"
        );
    }

    #[test]
    fn test_no_supersede_gate_failure_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::GateFailure {
            error: "cargo clippy found 2 errors".to_string(),
        };
        assert!(
            !execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "GateFailure trigger must NOT supersede — agent retries in the existing session"
        );
    }

    #[test]
    fn test_no_supersede_answers_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::Answers { answers: vec![] };
        assert!(
            !execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "Answers trigger must NOT supersede — resume the existing session"
        );
    }

    #[test]
    fn test_no_supersede_malformed_output_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let trigger = IterationTrigger::MalformedOutput {
            error: "invalid JSON".to_string(),
            attempt: 2,
            max_attempts: 3,
        };
        assert!(
            !execute(&*store, Some(&trigger), "task-1", "work").unwrap(),
            "MalformedOutput trigger must NOT supersede — agent retries in the existing session"
        );
    }

    #[test]
    fn test_no_supersede_interrupted_trigger() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        assert!(
            !execute(
                &*store,
                Some(&IterationTrigger::Interrupted),
                "task-1",
                "work"
            )
            .unwrap(),
            "Interrupted trigger must NOT supersede — resume the existing session"
        );
    }

    // -- No trigger: crash recovery vs clean re-entry --

    #[test]
    fn test_no_supersede_crash_recovery() {
        // Crash recovery: session spawned before, active iteration has stage_session_id set
        // (on_spawn_starting links the iteration to the session when the agent runs).
        let store = make_store_with_session(1);
        let iter = Iteration::new("iter-1", "task-1", "work", 1, "2020-01-01T00:00:00Z")
            .with_stage_session_id("session-1"); // linked → crash recovery
        store.save_iteration(&iter).unwrap();
        assert!(
            !execute(&*store, None, "task-1", "work").unwrap(),
            "No trigger + session-linked active iteration must NOT supersede — crash recovery"
        );
    }

    #[test]
    fn test_supersede_clean_reentry_prelinked_iteration() {
        // Clean re-entry: finalize_advancement pre-creates the iteration with stage_session_id=None.
        // The agent hasn't run yet so on_spawn_starting hasn't linked it.
        let store = make_store_with_session(1);
        let iter = Iteration::new("iter-1", "task-1", "work", 1, "2020-01-01T00:00:00Z");
        // stage_session_id is None by default — pre-created by finalize_advancement
        store.save_iteration(&iter).unwrap();
        assert!(
            execute(&*store, None, "task-1", "work").unwrap(),
            "No trigger + unlinked active iteration must supersede — clean re-entry"
        );
    }

    #[test]
    fn test_supersede_clean_reentry_no_active_iteration() {
        // Clean re-entry with no active iteration at all (previous iteration fully ended).
        let store = make_store_with_session(1);
        let mut iter = Iteration::new("iter-1", "task-1", "work", 1, "2020-01-01T00:00:00Z");
        iter.end("2020-01-01T01:00:00Z", Outcome::Approved);
        store.save_iteration(&iter).unwrap();
        assert!(
            execute(&*store, None, "task-1", "work").unwrap(),
            "No trigger + fully ended iteration must supersede — clean re-entry"
        );
    }

    #[test]
    fn test_no_supersede_first_spawn() {
        // Session exists but has never spawned (spawn_count=0) — first time through.
        let store = make_store_with_session(0);
        assert!(
            !execute(&*store, None, "task-1", "work").unwrap(),
            "No trigger + spawn_count=0 must NOT supersede — first spawn, no prior session"
        );
    }

    #[test]
    fn test_no_supersede_no_session() {
        // No session at all — definitely first time through.
        let store = Arc::new(InMemoryWorkflowStore::new());
        assert!(
            !execute(&*store, None, "task-1", "work").unwrap(),
            "No trigger + no session must NOT supersede"
        );
    }
}
