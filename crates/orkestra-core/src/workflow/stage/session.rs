//! Session types and integration tests for session lifecycle interactions.
//!
//! Business logic lives in `interactions/session/`. This file provides the
//! `SessionSpawnContext` type and integration tests that exercise the full
//! spawn lifecycle across multiple interactions.

// ============================================================================
// Spawn Context
// ============================================================================

/// Context needed before spawning an agent.
///
/// The session ID may be `None` for providers that generate their own IDs (e.g., `OpenCode`).
/// For providers that accept caller-supplied IDs (Claude Code), it contains a pre-generated UUID.
#[derive(Debug, Clone)]
pub struct SessionSpawnContext {
    /// The session ID, if available. `None` for providers that generate their own.
    pub session_id: Option<String>,
    /// Whether this is a resume (use `--resume`) or first spawn (use `--session-id`).
    /// True when the session has a stored ID AND either `has_activity` (agent produced output)
    /// OR the active iteration has a human-initiated resume trigger (`ManualResume` or
    /// `ReturnToWork`).
    /// Forced to `false` when `session_id` is `None` (can't resume without a session ID).
    pub is_resume: bool,
    /// The `StageSession.id` for log correlation. Unlike the old `"{task_id}-{stage}"`
    /// format, this is a UUID that uniquely identifies this session record.
    pub stage_session_id: String,
    /// ID of the iteration created/found for this spawn.
    /// Used to tag log entries with their iteration.
    pub iteration_id: String,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::domain::Task;
    use crate::workflow::iteration::IterationService;
    use crate::workflow::ports::WorkflowStore;
    use crate::workflow::query::interactions::sessions as query_sessions;

    use super::super::interactions::session;

    fn create_deps() -> (Arc<InMemoryWorkflowStore>, Arc<IterationService>) {
        let store = Arc::new(InMemoryWorkflowStore::new());
        store
            .save_task(&Task::new(
                "task-1",
                "Test Task",
                "Desc",
                "planning",
                "2020-01-01T00:00:00Z",
            ))
            .unwrap();
        let iteration_service = Arc::new(IterationService::new(
            Arc::clone(&store) as Arc<dyn WorkflowStore>
        ));
        (store, iteration_service)
    }

    /// Simulate agent exit: clear PID and save session.
    fn simulate_agent_exit(store: &InMemoryWorkflowStore, task_id: &str, stage: &str) {
        let mut s = store.get_stage_session(task_id, stage).unwrap().unwrap();
        s.agent_finished("now");
        store.save_stage_session(&s).unwrap();
    }

    #[test]
    fn test_spawn_context_first_spawn() {
        let (store, iter_svc) = create_deps();

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();

        assert_eq!(ctx.session_id, Some("test-uuid".to_string()));
        assert!(!ctx.is_resume);
    }

    #[test]
    fn test_spawn_context_with_resume() {
        let (store, iter_svc) = create_deps();

        // Start agent
        let first_ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();

        // Agent exits
        simulate_agent_exit(&store, "task-1", "planning");

        // Simulate agent activity (normally done by persist_activity_flag in dispatch_completion)
        let mut s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        s.has_activity = true;
        store.save_stage_session(&s).unwrap();

        // Next spawn — existing session keeps its ID (initial_session_id ignored)
        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("ignored-uuid".into()),
            None,
        )
        .unwrap();
        assert_eq!(ctx.session_id, first_ctx.session_id);
        assert!(ctx.is_resume);
    }

    #[test]
    fn test_caller_provided_session_id_stored() {
        let (store, iter_svc) = create_deps();

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("my-uuid".into()),
            None,
        )
        .unwrap();

        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(s.claude_session_id, Some("my-uuid".to_string()));
        assert_eq!(ctx.session_id, Some("my-uuid".to_string()));
    }

    #[test]
    fn test_no_session_id_for_own_id_provider() {
        let (store, iter_svc) = create_deps();

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            None,
            None,
        )
        .unwrap();

        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(s.claude_session_id.is_none());
        assert!(ctx.session_id.is_none());
        assert!(!ctx.is_resume);
    }

    #[test]
    fn test_no_resume_without_session_id() {
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            None,
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();
        simulate_agent_exit(&store, "task-1", "planning");

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            None,
            None,
        )
        .unwrap();
        assert!(ctx.session_id.is_none());
        assert!(!ctx.is_resume);
    }

    #[test]
    fn test_get_running_agents() {
        let (store, iter_svc) = create_deps();
        store
            .save_task(&Task::new(
                "task-2",
                "Test Task 2",
                "Desc",
                "planning",
                "2020-01-01T00:00:00Z",
            ))
            .unwrap();

        // Task 1 has running agent
        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();

        // Task 2 agent finished
        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-2",
            "planning",
            Some("test-uuid-2".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-2", "planning", 12346).unwrap();
        simulate_agent_exit(&store, "task-2", "planning");

        let running = query_sessions::get_running_agent_pids(store.as_ref()).unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].0, "task-1");
        assert_eq!(running[0].2, 12345);
    }

    // ========================================================================
    // Spawn Lifecycle Tests
    // ========================================================================

    #[test]
    fn test_spawn_starting_creates_session_and_iteration() {
        use crate::workflow::domain::SessionState;
        let (store, iter_svc) = create_deps();

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        assert_eq!(ctx.session_id, Some("test-uuid".to_string()));
        assert!(!ctx.is_resume);

        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(s.session_state, SessionState::Spawning);

        let iteration = store
            .get_active_iteration("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(iteration.is_active());
        assert!(iteration.stage_session_id.is_some());
    }

    #[test]
    fn test_spawn_starting_reuses_existing_iteration() {
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();
        simulate_agent_exit(&store, "task-1", "planning");

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();

        let iterations = store.get_iterations("task-1").unwrap();
        assert_eq!(iterations.len(), 1);
    }

    #[test]
    fn test_agent_spawned_transitions_to_active() {
        use crate::workflow::domain::SessionState;
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();

        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(s.session_state, SessionState::Active);
        assert_eq!(s.agent_pid, Some(12345));
    }

    #[test]
    fn test_spawn_failed_records_outcome() {
        use crate::workflow::domain::SessionState;
        use crate::workflow::runtime::Outcome;
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_spawn_failed::execute(
            store.as_ref(),
            "task-1",
            "planning",
            "Process not found",
        )
        .unwrap();

        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(s.session_state, SessionState::Active);

        let iterations = store.get_iterations("task-1").unwrap();
        let iteration = iterations.iter().find(|i| i.stage == "planning").unwrap();
        assert!(!iteration.is_active());

        match iteration.outcome.as_ref().unwrap() {
            Outcome::SpawnFailed { error } => {
                assert_eq!(error, "Process not found");
            }
            other => panic!("Expected SpawnFailed, got {other:?}"),
        }
    }

    #[test]
    fn test_spawn_failed_retry_is_not_resume() {
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_spawn_failed::execute(
            store.as_ref(),
            "task-1",
            "planning",
            "Process not found",
        )
        .unwrap();

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        assert!(
            !ctx.is_resume,
            "Retry after failed spawn should not be a resume"
        );
    }

    // ========================================================================
    // Trigger Delivery Tests
    // ========================================================================

    #[test]
    fn test_mark_trigger_delivered() {
        use crate::workflow::domain::IterationTrigger;
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "work",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();

        let mut iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        iter.incoming_context = Some(IterationTrigger::GateFailure {
            error: "test failed".into(),
        });
        store.save_iteration(&iter).unwrap();

        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(!iter.trigger_delivered);

        session::mark_trigger_delivered::execute(store.as_ref(), "task-1", "work").unwrap();

        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(iter.trigger_delivered);
        assert!(matches!(
            iter.incoming_context,
            Some(IterationTrigger::GateFailure { .. })
        ));
    }

    #[test]
    fn test_mark_trigger_delivered_noop_when_already_delivered() {
        use crate::workflow::domain::IterationTrigger;
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "work",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();

        let mut iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        iter.incoming_context = Some(IterationTrigger::Feedback {
            feedback: "fix this".into(),
        });
        iter.trigger_delivered = true;
        store.save_iteration(&iter).unwrap();

        session::mark_trigger_delivered::execute(store.as_ref(), "task-1", "work").unwrap();

        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(iter.trigger_delivered);
    }

    #[test]
    fn test_mark_trigger_delivered_noop_when_no_trigger() {
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "work",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();

        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(iter.incoming_context.is_none());

        session::mark_trigger_delivered::execute(store.as_ref(), "task-1", "work").unwrap();

        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(!iter.trigger_delivered);
    }

    #[test]
    fn test_resume_when_manual_resume_trigger_no_activity() {
        // Interrupt→resume: agent exits without producing output (has_activity = false),
        // then user resumes. Should resume the existing session, not start fresh.
        use crate::workflow::domain::IterationTrigger;
        let (store, iter_svc) = create_deps();

        // First spawn
        let first_ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "review",
            Some("original-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "review", 12345).unwrap();

        // Agent exits without producing structured output (no has_activity)
        simulate_agent_exit(&store, "task-1", "review");
        let s = store
            .get_stage_session("task-1", "review")
            .unwrap()
            .unwrap();
        assert!(!s.has_activity, "precondition: no activity");

        // User resumes from interrupt — creates new iteration with ManualResume trigger
        iter_svc
            .create_iteration(
                "task-1",
                "review",
                Some(IterationTrigger::ManualResume { message: None }),
            )
            .unwrap();

        // Next spawn: should resume the existing session (ManualResume overrides missing activity)
        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "review",
            Some("new-uuid".into()),
            None,
        )
        .unwrap();

        assert!(ctx.is_resume, "ManualResume trigger should cause resume");
        assert_eq!(
            ctx.session_id, first_ctx.session_id,
            "original session ID must be preserved"
        );
    }

    #[test]
    fn test_resume_when_return_to_work_trigger_no_activity() {
        // Interrupt→chat→return_to_work: agent exits without producing output
        // (has_activity = false), user chats, then returns to work. Should resume
        // the existing session, not start fresh.
        use crate::workflow::domain::IterationTrigger;
        let (store, iter_svc) = create_deps();

        // First spawn
        let first_ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "review",
            Some("original-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "review", 12345).unwrap();

        // Agent exits without producing structured output (no has_activity)
        simulate_agent_exit(&store, "task-1", "review");
        let s = store
            .get_stage_session("task-1", "review")
            .unwrap()
            .unwrap();
        assert!(!s.has_activity, "precondition: no activity");

        // User chats then returns to work — creates new iteration with ReturnToWork trigger
        iter_svc
            .create_iteration(
                "task-1",
                "review",
                Some(IterationTrigger::ReturnToWork {
                    message: Some("Just submit a rejection".to_string()),
                }),
            )
            .unwrap();

        // Next spawn: should resume the existing session (ReturnToWork overrides missing activity)
        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "review",
            Some("new-uuid".into()),
            None,
        )
        .unwrap();

        assert!(ctx.is_resume, "ReturnToWork trigger should cause resume");
        assert_eq!(
            ctx.session_id, first_ctx.session_id,
            "original session ID must be preserved"
        );
    }

    #[test]
    fn test_no_resume_when_no_activity_despite_spawn_count() {
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();
        simulate_agent_exit(&store, "task-1", "planning");

        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(s.spawn_count > 0);
        assert!(!s.has_activity);

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        assert!(!ctx.is_resume);
    }

    // ========================================================================
    // Supersede Session Tests
    // ========================================================================

    #[test]
    fn test_supersede_session() {
        use crate::workflow::domain::SessionState;
        let (store, iter_svc) = create_deps();

        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "work",
            Some("test-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "work", 12345).unwrap();
        simulate_agent_exit(&store, "task-1", "work");

        let s = store.get_stage_session("task-1", "work").unwrap().unwrap();
        assert_eq!(s.session_state, SessionState::Active);

        session::supersede_session::execute(store.as_ref(), "task-1", "work").unwrap();

        let s = store.get_stage_session("task-1", "work").unwrap();
        assert!(s.is_none());

        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "work",
            Some("new-uuid".into()),
            None,
        )
        .unwrap();
        assert!(!ctx.is_resume);
        assert_eq!(ctx.session_id, Some("new-uuid".to_string()));
    }

    #[test]
    fn test_supersede_session_noop_when_no_session() {
        let (store, _iter_svc) = create_deps();

        let result = session::supersede_session::execute(store.as_ref(), "task-1", "work");
        assert!(result.is_ok());
    }

    // ========================================================================
    // Stale Session ID Replacement Tests
    // ========================================================================

    #[test]
    fn test_stale_session_id_replaced_on_non_resume() {
        let (store, iter_svc) = create_deps();

        // First spawn creates session with ID
        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("original-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();
        simulate_agent_exit(&store, "task-1", "planning");

        // Session has ID but NO activity (simulating failed agent)
        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(!s.has_activity);
        assert_eq!(s.claude_session_id, Some("original-uuid".to_string()));

        // Next spawn with fresh ID should REPLACE the stale one
        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("fresh-uuid".into()),
            None,
        )
        .unwrap();

        assert!(!ctx.is_resume, "Should not be resume without activity");
        assert_eq!(
            ctx.session_id,
            Some("fresh-uuid".to_string()),
            "Should use fresh ID, not stale one"
        );

        // Verify the session in storage was also updated
        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(
            s.claude_session_id,
            Some("fresh-uuid".to_string()),
            "Stored session should have fresh ID"
        );
    }

    #[test]
    fn test_stale_session_id_kept_when_resuming() {
        let (store, iter_svc) = create_deps();

        // First spawn creates session with ID and activity
        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("original-uuid".into()),
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();
        simulate_agent_exit(&store, "task-1", "planning");

        // Simulate agent producing activity (successful output)
        let mut s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        s.has_activity = true;
        store.save_stage_session(&s).unwrap();

        // Next spawn should KEEP the original ID (is_resume = true)
        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            Some("ignored-uuid".into()),
            None,
        )
        .unwrap();

        assert!(ctx.is_resume, "Should be resume with activity");
        assert_eq!(
            ctx.session_id,
            Some("original-uuid".to_string()),
            "Should keep original ID when resuming"
        );
    }

    #[test]
    fn test_stale_session_id_cleared_for_own_id_provider() {
        let (store, iter_svc) = create_deps();

        // First spawn for own-ID provider (initial_session_id = None)
        session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            None, // Own-ID provider
            None,
        )
        .unwrap();
        session::on_agent_spawned::execute(store.as_ref(), "task-1", "planning", 12345).unwrap();

        // Simulate provider registering its own session ID (e.g., from extracted_session_id)
        let mut s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        s.claude_session_id = Some("provider-generated-id".to_string());
        store.save_stage_session(&s).unwrap();

        simulate_agent_exit(&store, "task-1", "planning");

        // Session has ID but NO activity (simulating failed agent)
        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(!s.has_activity);
        assert_eq!(
            s.claude_session_id,
            Some("provider-generated-id".to_string())
        );

        // Next spawn should CLEAR the stale session ID (not resume without activity)
        let ctx = session::on_spawn_starting::execute(
            store.as_ref(),
            &iter_svc,
            "task-1",
            "planning",
            None, // Own-ID provider
            None,
        )
        .unwrap();

        assert!(!ctx.is_resume, "Should not be resume without activity");
        assert_eq!(
            ctx.session_id, None,
            "Should clear stale ID for own-ID provider"
        );

        // Verify the session in storage was also cleared
        let s = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(
            s.claude_session_id, None,
            "Stored session should have cleared ID"
        );
    }
}
