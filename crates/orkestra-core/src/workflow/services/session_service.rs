//! Session management service.
//!
//! This service manages Claude session continuity across agent spawns.
//! It tracks which Claude session ID is associated with each task+stage,
//! enabling resume functionality when agents are restarted.
//!
//! The service is responsible for:
//! - Providing spawn context (resume session ID) before spawning
//! - Ensuring an iteration exists before spawning (delegates to `IterationService`)
//! - Recording agent PIDs when agents start
//! - Recording Claude session IDs when captured from output
//! - Clearing PIDs when agents exit
//! - Completing/abandoning sessions on stage transitions

use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::domain::{SessionState, StageSession};
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

use super::IterationService;

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
    /// Based on `has_activity` — only resume if the agent produced output in a prior spawn.
    /// Forced to `false` when `session_id` is `None` (can't resume without a session ID).
    pub is_resume: bool,
    /// Whether this is an untriggered stage re-entry (e.g., review running again after
    /// work→checks→review cycle). Detected when resuming but the active iteration has
    /// no `stage_session_id` (never linked to this session) and no `incoming_context`
    /// (no trigger like rejection or script failure).
    pub is_stage_reentry: bool,
    /// The `StageSession.id` for log correlation. Unlike the old `"{task_id}-{stage}"`
    /// format, this is a UUID that uniquely identifies this session record.
    pub stage_session_id: String,
}

// ============================================================================
// Session Service
// ============================================================================

/// Service for managing Claude session lifecycle.
///
/// This service tracks Claude sessions across agent spawns, enabling
/// resume functionality when agents are restarted. Each task+stage
/// combination gets a single session that persists across rejections
/// and retries.
pub struct SessionService {
    store: Arc<dyn WorkflowStore>,
    iteration_service: Arc<IterationService>,
}

impl SessionService {
    /// Create a new session service with the given store and iteration service.
    pub fn new(store: Arc<dyn WorkflowStore>, iteration_service: Arc<IterationService>) -> Self {
        Self {
            store,
            iteration_service,
        }
    }

    // ========================================================================
    // Spawn Lifecycle Methods
    // ========================================================================

    /// Create session and iteration before spawn attempt, returning spawn context.
    ///
    /// This is called BEFORE attempting to spawn the agent process.
    /// Creates or updates a session in `Spawning` state.
    /// Creates a new iteration only if there's no active one for this stage.
    ///
    /// Returns `SessionSpawnContext` containing the session ID, resume flag, and
    /// stage re-entry detection. Re-entry is computed **before** linking the
    /// iteration to the session, so the `stage_session_id.is_none()` check
    /// correctly detects fresh iterations that haven't been spawned yet.
    ///
    /// # Arguments
    ///
    /// * `initial_session_id` — Pre-generated session ID for providers that accept caller-supplied
    ///   IDs (Claude Code). Pass `None` for providers that generate their own (`OpenCode`).
    ///   Only used when creating a NEW session; existing sessions keep their current ID.
    pub fn on_spawn_starting(
        &self,
        task_id: &str,
        stage: &str,
        initial_session_id: Option<String>,
    ) -> WorkflowResult<SessionSpawnContext> {
        let now = chrono::Utc::now().to_rfc3339();

        // Get or create session in Spawning state
        let session = if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            // Existing session — keep existing claude_session_id unchanged
            session.session_state = SessionState::Spawning;
            session.updated_at.clone_from(&now);
            session
        } else {
            // New session with UUID-based ID
            let session_id = uuid::Uuid::new_v4().to_string();
            let mut session = StageSession::new(&session_id, task_id, stage, &now);
            session.claude_session_id = initial_session_id;
            session.session_state = SessionState::Spawning;
            session
        };

        let stage_session_id = session.id.clone();

        // Compute resume/reentry BEFORE saving the session or linking the iteration.
        // is_resume: true if we have a session ID AND the agent produced output.
        let is_resume = session.claude_session_id.is_some() && session.has_activity;

        orkestra_debug!(
            "session",
            "on_spawn_starting {}/{}: claude_session_id={:?}, state={:?}, spawn_count={}, has_activity={}",
            task_id,
            stage,
            session.claude_session_id,
            session.session_state,
            session.spawn_count,
            session.has_activity
        );

        self.store.save_stage_session(&session)?;

        // Get or create iteration — delegates to IterationService
        let iteration =
            if let Some(active_iter) = self.store.get_active_iteration(task_id, stage)? {
                active_iter
            } else {
                orkestra_debug!(
                    "session",
                    "on_spawn_starting {}/{}: creating iteration via IterationService",
                    task_id,
                    stage
                );
                self.iteration_service
                    .create_iteration(task_id, stage, None)?
            };

        // Detect untriggered re-entry BEFORE linking: resuming a session but with a
        // fresh iteration that has no trigger and wasn't linked to this session yet.
        let is_stage_reentry = is_resume
            && iteration.stage_session_id.is_none()
            && iteration.incoming_context.is_none();

        orkestra_debug!(
            "session",
            "on_spawn_starting {}/{}: is_resume={}, is_stage_reentry={}",
            task_id,
            stage,
            is_resume,
            is_stage_reentry
        );

        // Link the session to the iteration for log recovery
        let iteration = iteration.with_stage_session_id(&stage_session_id);
        self.store.save_iteration(&iteration)?;

        Ok(SessionSpawnContext {
            session_id: session.claude_session_id,
            is_resume,
            is_stage_reentry,
            stage_session_id,
        })
    }

    /// Update session after successful spawn.
    ///
    /// Transitions session from `Spawning` to `Active`, records PID, and increments
    /// `spawn_count` so that if the agent crashes, the next spawn uses `--resume`.
    ///
    /// # Errors
    ///
    /// Returns an error if no session exists (`on_spawn_starting` should have been called first).
    pub fn on_agent_spawned(&self, task_id: &str, stage: &str, pid: u32) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        let mut session = self
            .store
            .get_stage_session(task_id, stage)?
            .ok_or_else(|| {
                crate::workflow::ports::WorkflowError::StageSessionNotFound(format!(
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

        self.store.save_stage_session(&session)
    }

    /// Mark the iteration's trigger as delivered to the agent.
    ///
    /// Called after a successful resume spawn so that if the agent crashes again,
    /// the next resume uses "Your session was interrupted" instead of replaying
    /// the original trigger (e.g., script failure details the agent already received).
    pub fn mark_trigger_delivered(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut iter) = self.store.get_active_iteration(task_id, stage)? {
            if !iter.trigger_delivered && iter.incoming_context.is_some() {
                orkestra_debug!(
                    "session",
                    "mark_trigger_delivered {}/{}: marking trigger as delivered",
                    task_id,
                    stage
                );
                iter.trigger_delivered = true;
                self.store.save_iteration(&iter)?;
            }
        }
        Ok(())
    }

    /// Record spawn failure in iteration.
    ///
    /// Sets the current iteration's outcome to `SpawnFailed` and transitions
    /// session back to `Active` (ready for retry).
    ///
    /// # Errors
    ///
    /// Returns an error if no session exists (`on_spawn_starting` should have been called first).
    pub fn on_spawn_failed(&self, task_id: &str, stage: &str, error: &str) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        // Update session state to Active (ready for retry)
        let mut session = self
            .store
            .get_stage_session(task_id, stage)?
            .ok_or_else(|| {
                crate::workflow::ports::WorkflowError::StageSessionNotFound(format!(
                    "{task_id}/{stage} - on_spawn_starting must be called first"
                ))
            })?;

        session.session_state = SessionState::Active;
        session.updated_at.clone_from(&now);
        self.store.save_stage_session(&session)?;

        // Find and end the active iteration with SpawnFailed outcome
        if let Some(mut iteration) = self.store.get_active_iteration(task_id, stage)? {
            iteration.end(
                &now,
                Outcome::SpawnFailed {
                    error: error.to_string(),
                },
            );
            self.store.save_iteration(&iteration)?;
        }

        Ok(())
    }

    /// Record that the agent process exited.
    ///
    /// Clears the PID and keeps the session active for potential resume.
    /// Note: `spawn_count` was already incremented at spawn time in `on_agent_spawned()`.
    pub fn on_agent_exited(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
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

            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Mark the stage session as completed.
    ///
    /// Called when the stage is approved and we're moving to the next stage.
    /// Completed sessions cannot be resumed.
    pub fn on_stage_completed(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        orkestra_debug!("session", "on_stage_completed {}/{}", task_id, stage);

        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.session_state = SessionState::Completed;
            session.agent_pid = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Mark the stage session as abandoned.
    ///
    /// Called when the task fails, is blocked, or the stage is rejected.
    /// Abandoned sessions cannot be resumed.
    pub fn on_stage_abandoned(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        orkestra_debug!("session", "on_stage_abandoned {}/{}", task_id, stage);

        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.session_state = SessionState::Abandoned;
            session.agent_pid = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Supersede the active session for a stage, forcing the next spawn to create
    /// a fresh session. No-op if no active session exists.
    pub fn supersede_session(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.supersede(&now);
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Get all sessions with running agents.
    ///
    /// Returns `(task_id, stage, pid)` tuples for sessions that have PIDs.
    /// Used for orphan cleanup on startup.
    pub fn get_running_agents(&self) -> WorkflowResult<Vec<(String, String, u32)>> {
        let sessions = self.store.get_sessions_with_pids()?;
        Ok(sessions
            .into_iter()
            .filter_map(|s| s.agent_pid.map(|pid| (s.task_id, s.stage, pid)))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;

    fn create_service() -> (SessionService, Arc<InMemoryWorkflowStore>) {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let iteration_service = Arc::new(IterationService::new(
            Arc::clone(&store) as Arc<dyn WorkflowStore>
        ));
        let session_service = SessionService::new(
            Arc::clone(&store) as Arc<dyn WorkflowStore>,
            iteration_service,
        );
        (session_service, store)
    }

    #[test]
    fn test_spawn_context_first_spawn() {
        let (service, _store) = create_service();

        // on_spawn_starting creates session + iteration and returns context
        let ctx = service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();

        // Should have session ID (caller-provided) but not be a resume
        assert_eq!(ctx.session_id, Some("test-uuid".to_string()));
        assert!(!ctx.is_resume); // spawn_count is 0
    }

    #[test]
    fn test_spawn_context_with_resume() {
        let (service, store) = create_service();

        // Start agent
        let first_ctx = service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();

        // Agent exits (spawn_count was already incremented in on_agent_spawned)
        service.on_agent_exited("task-1", "planning").unwrap();

        // Simulate agent activity (normally done by persist_activity_flags in poll_agents)
        let mut session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        session.has_activity = true;
        store.save_stage_session(&session).unwrap();

        // Next spawn — existing session keeps its ID (initial_session_id ignored)
        let ctx = service
            .on_spawn_starting("task-1", "planning", Some("ignored-uuid".into()))
            .unwrap();
        assert_eq!(ctx.session_id, first_ctx.session_id); // Same session ID from first creation
        assert!(ctx.is_resume); // has_activity is now true
    }

    #[test]
    fn test_caller_provided_session_id_stored() {
        let (service, store) = create_service();

        // Create session with a caller-provided session ID (Claude Code behavior)
        let ctx = service
            .on_spawn_starting("task-1", "planning", Some("my-uuid".into()))
            .unwrap();

        // Session should have the caller-provided ID
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session.claude_session_id, Some("my-uuid".to_string()));

        // Spawn context returns the same ID
        assert_eq!(ctx.session_id, Some("my-uuid".to_string()));
    }

    #[test]
    fn test_no_session_id_for_own_id_provider() {
        let (service, store) = create_service();

        // Create session with None (OpenCode behavior — generates its own ID)
        let ctx = service
            .on_spawn_starting("task-1", "planning", None)
            .unwrap();

        // Session should have no session ID
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(session.claude_session_id.is_none());

        // Spawn context returns None session ID and is_resume=false
        assert!(ctx.session_id.is_none());
        assert!(!ctx.is_resume);
    }

    #[test]
    fn test_no_resume_without_session_id() {
        let (service, _store) = create_service();

        // Create session with None (OpenCode behavior)
        service
            .on_spawn_starting("task-1", "planning", None)
            .unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();
        service.on_agent_exited("task-1", "planning").unwrap();

        // Even after spawn+exit (spawn_count > 0), can't resume without session ID
        let ctx = service
            .on_spawn_starting("task-1", "planning", None)
            .unwrap();
        assert!(ctx.session_id.is_none());
        assert!(!ctx.is_resume); // Forced to false — no session ID to resume with
    }

    #[test]
    fn test_get_running_agents() {
        let (service, _store) = create_service();

        // Task 1 has running agent
        service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();

        // Task 2 agent finished
        service
            .on_spawn_starting("task-2", "planning", Some("test-uuid-2".into()))
            .unwrap();
        service
            .on_agent_spawned("task-2", "planning", 12346)
            .unwrap();
        service.on_agent_exited("task-2", "planning").unwrap();

        let running = service.get_running_agents().unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].0, "task-1");
        assert_eq!(running[0].2, 12345);
    }

    // ========================================================================
    // Spawn Lifecycle Tests
    // ========================================================================

    #[test]
    fn test_spawn_starting_creates_session_and_iteration() {
        let (service, store) = create_service();

        // on_spawn_starting creates both session and iteration (via IterationService)
        let ctx = service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();
        assert_eq!(ctx.session_id, Some("test-uuid".to_string()));
        assert!(!ctx.is_resume);
        assert!(!ctx.is_stage_reentry);

        // Session should be in Spawning state
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session.session_state, SessionState::Spawning);

        // Iteration should exist, be active, and have the session linked
        let iteration = store
            .get_active_iteration("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(iteration.is_active());
        // Session should be linked to iteration
        assert!(iteration.stage_session_id.is_some());
    }

    #[test]
    fn test_spawn_starting_reuses_existing_iteration() {
        let (service, store) = create_service();

        // First call creates iteration
        service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();
        service.on_agent_exited("task-1", "planning").unwrap();

        // Second call should reuse the same iteration (it's still active)
        service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();

        // Should still be only one iteration
        let iterations = store.get_iterations("task-1").unwrap();
        assert_eq!(iterations.len(), 1);
    }

    #[test]
    fn test_agent_spawned_transitions_to_active() {
        let (service, store) = create_service();

        // Start spawn (creates session and iteration)
        service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();

        // Spawn succeeded
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();

        // Session should be Active with PID
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session.session_state, SessionState::Active);
        assert_eq!(session.agent_pid, Some(12345));
    }

    #[test]
    fn test_spawn_failed_records_outcome() {
        let (service, store) = create_service();

        // Start spawn (creates session and iteration)
        service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();

        // Spawn failed
        service
            .on_spawn_failed("task-1", "planning", "Process not found")
            .unwrap();

        // Session should be Active (ready for retry)
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session.session_state, SessionState::Active);

        // Iteration should have SpawnFailed outcome
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
        // Verifies that if a spawn FAILS (process never started), the retry
        // should NOT use --resume because no Claude session file was created.
        // This is correct because spawn_count is only incremented in on_agent_spawned,
        // which is never called when spawn fails.
        let (service, _store) = create_service();

        // Start spawn attempt
        service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();

        // Spawn fails before process starts (on_agent_spawned never called)
        service
            .on_spawn_failed("task-1", "planning", "Process not found")
            .unwrap();

        // Retry: on_spawn_starting returns context directly
        let ctx = service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();

        // Should NOT be a resume because on_agent_spawned was never called
        assert!(
            !ctx.is_resume,
            "Retry after failed spawn should not be a resume (no Claude session exists)"
        );
    }

    // ========================================================================
    // Trigger Delivery Tests
    // ========================================================================

    // ========================================================================
    // Stage Re-entry Detection Tests
    // ========================================================================

    #[test]
    fn test_reentry_detected_on_untriggered_fresh_iteration() {
        // Scenario: review ran, approved, task went through work→checks→review cycle,
        // now review has a new iteration (no trigger, no session link). Should detect re-entry.
        let (service, store) = create_service();

        // First spawn of review: create session + iteration, spawn, exit
        service
            .on_spawn_starting("task-1", "review", Some("test-uuid".into()))
            .unwrap();
        service.on_agent_spawned("task-1", "review", 12345).unwrap();
        service.on_agent_exited("task-1", "review").unwrap();

        // Simulate agent activity (normally done by persist_activity_flags in poll_agents)
        let mut session = store
            .get_stage_session("task-1", "review")
            .unwrap()
            .unwrap();
        session.has_activity = true;
        store.save_stage_session(&session).unwrap();

        // End the first iteration (simulating stage completion)
        let mut iter = store
            .get_active_iteration("task-1", "review")
            .unwrap()
            .unwrap();
        iter.end("now", Outcome::Approved);
        store.save_iteration(&iter).unwrap();

        // Create a fresh iteration for re-entry (no trigger, no session link)
        let iteration_service = Arc::new(IterationService::new(
            Arc::clone(&store) as Arc<dyn WorkflowStore>
        ));
        iteration_service
            .create_iteration("task-1", "review", None)
            .unwrap();

        // on_spawn_starting detects re-entry: the fresh iteration has no
        // stage_session_id and no incoming_context BEFORE linking occurs.
        let ctx = service
            .on_spawn_starting("task-1", "review", Some("test-uuid".into()))
            .unwrap();
        assert!(
            ctx.is_resume,
            "Should be a resume (session has prior spawns and activity)"
        );
        assert!(
            ctx.is_stage_reentry,
            "Should detect re-entry: fresh iteration with no trigger and no session link"
        );
    }

    #[test]
    fn test_reentry_not_detected_on_triggered_iteration() {
        use crate::workflow::domain::IterationTrigger;

        // Same setup but iteration has a Rejection trigger. Should NOT detect re-entry.
        let (service, store) = create_service();

        service
            .on_spawn_starting("task-1", "review", Some("test-uuid".into()))
            .unwrap();
        service.on_agent_spawned("task-1", "review", 12345).unwrap();
        service.on_agent_exited("task-1", "review").unwrap();

        // Simulate agent activity (normally done by persist_activity_flags in poll_agents)
        let mut session = store
            .get_stage_session("task-1", "review")
            .unwrap()
            .unwrap();
        session.has_activity = true;
        store.save_stage_session(&session).unwrap();

        // End the first iteration
        let mut iter = store
            .get_active_iteration("task-1", "review")
            .unwrap()
            .unwrap();
        iter.end("now", Outcome::Approved);
        store.save_iteration(&iter).unwrap();

        // Create iteration WITH a trigger (e.g., rejection feedback)
        let iteration_service = Arc::new(IterationService::new(
            Arc::clone(&store) as Arc<dyn WorkflowStore>
        ));
        iteration_service
            .create_iteration(
                "task-1",
                "review",
                Some(IterationTrigger::Rejection {
                    from_stage: "review".into(),
                    feedback: "needs more work".into(),
                }),
            )
            .unwrap();

        let ctx = service
            .on_spawn_starting("task-1", "review", Some("test-uuid".into()))
            .unwrap();
        assert!(ctx.is_resume);
        assert!(
            !ctx.is_stage_reentry,
            "Should NOT detect re-entry: iteration has a trigger"
        );
    }

    #[test]
    fn test_reentry_not_detected_on_crash_resume() {
        // Agent was spawned but crashed — iteration still linked to session.
        // Should NOT detect re-entry (it's a crash resume).
        let (service, store) = create_service();

        service
            .on_spawn_starting("task-1", "review", Some("test-uuid".into()))
            .unwrap();
        service.on_agent_spawned("task-1", "review", 12345).unwrap();
        service.on_agent_exited("task-1", "review").unwrap();

        // Simulate agent activity (normally done by persist_activity_flags in poll_agents)
        let mut session = store
            .get_stage_session("task-1", "review")
            .unwrap()
            .unwrap();
        session.has_activity = true;
        store.save_stage_session(&session).unwrap();

        // DON'T end iteration — it's still active and linked to the session
        // (on_spawn_starting linked it via with_stage_session_id)

        // Second on_spawn_starting should detect crash resume (not re-entry)
        let ctx = service
            .on_spawn_starting("task-1", "review", Some("test-uuid".into()))
            .unwrap();
        assert!(ctx.is_resume);
        assert!(
            !ctx.is_stage_reentry,
            "Should NOT detect re-entry: iteration is still linked to session (crash resume)"
        );
    }

    // ========================================================================
    // Trigger Delivery Tests
    // ========================================================================

    #[test]
    fn test_mark_trigger_delivered() {
        use crate::workflow::domain::IterationTrigger;
        let (service, store) = create_service();

        // Create session and iteration
        service
            .on_spawn_starting("task-1", "work", Some("test-uuid".into()))
            .unwrap();

        // Set a trigger on the active iteration
        let mut iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        iter.incoming_context = Some(IterationTrigger::ScriptFailure {
            from_stage: "checks".into(),
            error: "test failed".into(),
        });
        store.save_iteration(&iter).unwrap();

        // Before marking: trigger_delivered should be false
        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(!iter.trigger_delivered);

        // Mark trigger as delivered
        service.mark_trigger_delivered("task-1", "work").unwrap();

        // After marking: trigger_delivered should be true, but incoming_context preserved
        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(iter.trigger_delivered);
        assert!(matches!(
            iter.incoming_context,
            Some(IterationTrigger::ScriptFailure { .. })
        ));
    }

    #[test]
    fn test_mark_trigger_delivered_noop_when_already_delivered() {
        use crate::workflow::domain::IterationTrigger;
        let (service, store) = create_service();

        service
            .on_spawn_starting("task-1", "work", Some("test-uuid".into()))
            .unwrap();

        // Set trigger and mark as delivered
        let mut iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        iter.incoming_context = Some(IterationTrigger::Feedback {
            feedback: "fix this".into(),
        });
        iter.trigger_delivered = true;
        store.save_iteration(&iter).unwrap();

        // Calling again should be a no-op
        service.mark_trigger_delivered("task-1", "work").unwrap();

        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(iter.trigger_delivered);
    }

    #[test]
    fn test_mark_trigger_delivered_noop_when_no_trigger() {
        let (service, store) = create_service();

        service
            .on_spawn_starting("task-1", "work", Some("test-uuid".into()))
            .unwrap();

        // No incoming_context set (None)
        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(iter.incoming_context.is_none());

        // Should succeed without marking (nothing to deliver)
        service.mark_trigger_delivered("task-1", "work").unwrap();

        let iter = store
            .get_active_iteration("task-1", "work")
            .unwrap()
            .unwrap();
        assert!(!iter.trigger_delivered);
    }

    #[test]
    fn test_no_resume_when_no_activity_despite_spawn_count() {
        // Regression test: session with spawn_count > 0 but has_activity = false
        // should NOT trigger resume. This is the core bug this fix addresses.
        let (service, store) = create_service();

        // Create session and spawn agent
        service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();
        // Agent exits but has_activity was never set (agent killed before output)
        service.on_agent_exited("task-1", "planning").unwrap();

        // Verify: spawn_count > 0 but has_activity is false
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(session.spawn_count > 0, "spawn_count should be > 0");
        assert!(!session.has_activity, "has_activity should be false");

        // Next spawn should NOT be resume (has_activity is false)
        let ctx = service
            .on_spawn_starting("task-1", "planning", Some("test-uuid".into()))
            .unwrap();
        assert!(
            !ctx.is_resume,
            "Should NOT resume when has_activity is false, even with spawn_count > 0"
        );
    }

    // ========================================================================
    // Supersede Session Tests
    // ========================================================================

    #[test]
    fn test_supersede_session() {
        use crate::workflow::domain::SessionState;

        let (service, store) = create_service();

        // Create and spawn a session
        service
            .on_spawn_starting("task-1", "work", Some("test-uuid".into()))
            .unwrap();
        service.on_agent_spawned("task-1", "work", 12345).unwrap();
        service.on_agent_exited("task-1", "work").unwrap();

        // Verify session exists and is Active
        let session = store
            .get_stage_session("task-1", "work")
            .unwrap()
            .unwrap();
        assert_eq!(session.session_state, SessionState::Active);

        // Supersede the session
        service.supersede_session("task-1", "work").unwrap();

        // After supersede, get_stage_session should return None (filtered out)
        let session = store.get_stage_session("task-1", "work").unwrap();
        assert!(
            session.is_none(),
            "Superseded session should be filtered out by get_stage_session"
        );

        // Next spawn should create a new session
        let ctx = service
            .on_spawn_starting("task-1", "work", Some("new-uuid".into()))
            .unwrap();
        assert!(
            !ctx.is_resume,
            "After supersede, next spawn should NOT be a resume"
        );
        assert_eq!(
            ctx.session_id,
            Some("new-uuid".to_string()),
            "New spawn should use new session ID"
        );
    }

    #[test]
    fn test_supersede_session_noop_when_no_session() {
        let (service, _store) = create_service();

        // Supersede a non-existent session should succeed without error
        let result = service.supersede_session("task-1", "work");
        assert!(
            result.is_ok(),
            "supersede_session should be no-op when no session exists"
        );
    }
}
