//! Decide whether to supersede the existing stage session before spawning.

use crate::workflow::domain::IterationTrigger;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Determine whether to supersede the existing stage session before spawning.
///
/// Returns `true` for "returning" scenarios — triggers that indicate the task
/// is *returning* to this stage for a fresh attempt, not *iterating* within
/// an existing session:
/// - `Rejection`: stage output was rejected (by human or reviewer agent) — start fresh.
/// - `Integration`: merge conflict recovery returned the task here.
/// - Untriggered re-entry: no trigger AND the active iteration has not been
///   linked to a session yet, meaning this is a clean re-entry (not a
///   crash-recovery or `ManualResume`).
///
/// Triggers that do NOT supersede (agent resumes in the existing session):
/// - `Feedback`: human or reviewer sent a follow-up request (e.g., `request_update`
///   or the reviewer-override path in `reject.rs`) — resume the session with the
///   feedback as new context.
/// - `GateFailure`: gate script failed — agent re-runs in the existing session with
///   the gate error as feedback context.
/// - `PrFeedback`: PR comments, failing checks, or guidance submitted for a Done task
///   — agent re-runs in the existing session with the PR feedback as new context.
/// - All other triggers (`RetryFailed`, `RetryBlocked`, `Answers`, etc.) also fall
///   through to `Ok(false)`.
pub fn execute(
    store: &dyn WorkflowStore,
    trigger: Option<&IterationTrigger>,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<bool> {
    // Returning triggers always create a fresh session.
    if matches!(
        trigger,
        Some(IterationTrigger::Rejection { .. } | IterationTrigger::Integration { .. })
    ) {
        return Ok(true);
    }

    // Untriggered re-entry: no trigger AND the stage already has an active session
    // that was previously spawned (`spawn_count > 0`). This means the stage is being
    // entered again for a new pass, not for the first time.
    //
    // Note: `get_active_iteration` is NOT used here because the new-pass iteration
    // hasn't been created yet at this point — `on_spawn_starting` creates it lazily.
    // Instead, we check whether the existing session was already used.
    if trigger.is_none() {
        if let Some(session) = store.get_stage_session(task_id, stage)? {
            if session.spawn_count > 0 {
                return Ok(true);
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
    use crate::workflow::domain::StageSession;
    use crate::workflow::InMemoryWorkflowStore;

    #[test]
    fn test_supersede_rejection_trigger() {
        let store = InMemoryWorkflowStore::new();
        let trigger = IterationTrigger::Rejection {
            from_stage: "review".to_string(),
            feedback: "needs work".to_string(),
        };
        let result = execute(&store, Some(&trigger), "task-1", "work").unwrap();
        assert!(result, "Rejection trigger must supersede the session");
    }

    #[test]
    fn test_supersede_integration_trigger() {
        let store = InMemoryWorkflowStore::new();
        let trigger = IterationTrigger::Integration {
            message: "merge conflict".to_string(),
            conflict_files: vec!["src/main.rs".to_string()],
        };
        let result = execute(&store, Some(&trigger), "task-1", "work").unwrap();
        assert!(result, "Integration trigger must supersede the session");
    }

    #[test]
    fn test_supersede_untriggered_reentry_with_existing_spawned_session() {
        let store = InMemoryWorkflowStore::new();
        let mut session = StageSession::new("sess-1", "task-1", "work", "2024-01-01T00:00:00Z");
        session.spawn_count = 1;
        store.save_stage_session(&session).unwrap();

        let result = execute(&store, None, "task-1", "work").unwrap();
        assert!(
            result,
            "Untriggered re-entry with an already-spawned session must supersede"
        );
    }

    #[test]
    fn test_no_supersede_feedback_trigger() {
        let store = InMemoryWorkflowStore::new();
        // Set up a session so the untriggered-reentry check would fire if trigger were None.
        let mut session = StageSession::new("sess-1", "task-1", "work", "2024-01-01T00:00:00Z");
        session.spawn_count = 1;
        store.save_stage_session(&session).unwrap();

        let trigger = IterationTrigger::Feedback {
            feedback: "please revise".to_string(),
        };
        let result = execute(&store, Some(&trigger), "task-1", "work").unwrap();
        assert!(
            !result,
            "Feedback trigger (from request_update) must NOT supersede — resume the session"
        );
    }

    #[test]
    fn test_no_supersede_retry_failed_trigger() {
        let store = InMemoryWorkflowStore::new();
        let trigger = IterationTrigger::RetryFailed {
            instructions: Some("try again".to_string()),
        };
        let result = execute(&store, Some(&trigger), "task-1", "work").unwrap();
        assert!(
            !result,
            "RetryFailed trigger must NOT supersede — resume so agent can continue where it left off"
        );
    }

    #[test]
    fn test_no_supersede_untriggered_first_entry() {
        // No session exists yet → spawn_count check finds nothing → return false.
        let store = InMemoryWorkflowStore::new();
        let result = execute(&store, None, "task-1", "work").unwrap();
        assert!(
            !result,
            "No trigger and no existing session should not supersede (first entry)"
        );
    }

    #[test]
    fn test_no_supersede_gate_failure_trigger() {
        let store = InMemoryWorkflowStore::new();
        // Set up a session so the untriggered-reentry check would fire if trigger were None.
        let mut session = StageSession::new("sess-1", "task-1", "work", "2024-01-01T00:00:00Z");
        session.spawn_count = 1;
        store.save_stage_session(&session).unwrap();

        let trigger = IterationTrigger::GateFailure {
            error: "cargo clippy found 2 errors".to_string(),
        };
        let result = execute(&store, Some(&trigger), "task-1", "work").unwrap();
        assert!(
            !result,
            "GateFailure trigger must NOT supersede — agent re-runs in the existing session with gate error as context"
        );
    }

    #[test]
    fn test_no_supersede_untriggered_session_not_yet_spawned() {
        // Session exists but has never been spawned (spawn_count == 0).
        // This is still a "first entry" — no agent has run yet — so no supersession.
        let store = InMemoryWorkflowStore::new();
        let session = StageSession::new("sess-1", "task-1", "work", "2024-01-01T00:00:00Z");
        // spawn_count defaults to 0 — do not increment it
        store.save_stage_session(&session).unwrap();

        let result = execute(&store, None, "task-1", "work").unwrap();
        assert!(
            !result,
            "Existing session with spawn_count == 0 is still first entry; must NOT supersede"
        );
    }
}
